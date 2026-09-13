import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import type { User as SelectUser } from "@shared/schema";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

export function setupAuth(app: Express) {
  const mongoUri = process.env.MONGODB_URI!;

  // Always trust the first proxy (Nginx on VPS, Replit's proxy in dev)
  app.set("trust proxy", 1);

  // Nginx on this VPS does not forward X-Forwarded-Proto.
  // express-session's `issecure()` check will fail without it, causing
  // the Secure cookie to never be sent. Patch the header here so the
  // session middleware sees the connection as HTTPS in production.
  if (process.env.NODE_ENV === "production") {
    app.use((req, _res, next) => {
      if (!req.headers["x-forwarded-proto"]) {
        req.headers["x-forwarded-proto"] = "https";
      }
      next();
    });
  }

  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    rolling: true, // Refresh cookie expiry on every request
    store: MongoStore.create({
      mongoUrl: mongoUri,
      dbName: "fishtokri_admin",
      collectionName: "sessions",
      ttl: 30 * 24 * 60 * 60, // 30 days in seconds
    }),
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  };

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        if (!user || !(await comparePasswords(password, user.password))) {
          return done(null, false, { message: "Invalid username or password" });
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }),
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  (async () => {
    try {
      const admin = await storage.getUserByUsername("admin");
      if (!admin) {
        const hashedPassword = await hashPassword("admin");
        await storage.createUser({ username: "admin", password: hashedPassword });
        console.log("Created default admin user: admin / admin");
      }
    } catch (error) {
      console.error("Failed to ensure default admin exists:", error);
    }
  })();
}
