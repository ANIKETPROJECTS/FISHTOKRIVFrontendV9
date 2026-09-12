module.exports = {
  apps: [
    {
      name: "fishtokriwebsite",
      script: "dist/index.cjs",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        PORT: 3013,
        MONGODB_URI: process.env.MONGODB_URI,
        SESSION_SECRET: process.env.SESSION_SECRET,
        VITE_GOOGLE_MAPS_API_KEY: process.env.VITE_GOOGLE_MAPS_API_KEY,
        ADMARK_API_KEY: process.env.ADMARK_API_KEY,
        ADMARK_PHONE_NUMBER_ID: process.env.ADMARK_PHONE_NUMBER_ID,
        RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
        RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
        RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET
      }
    }
  ]
};
