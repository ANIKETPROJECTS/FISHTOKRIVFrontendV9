module.exports = {
  apps: [
    {
      name: "fishtokriwebsite",
      script: "dist/index.cjs",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        PORT: 3013,
        MONGODB_URI: "mongodb://admin:FishTokri%40132231@187.127.174.48:27017/?authSource=admin",
        SESSION_SECRET: "4ht7xAFRChv4cXoq7wxN95DCONA9VrRalzJjMP7QlxcIp4QjKhHl2aC4snWbF5EwL7EKkOSSmyT7NEEEtsQn7Q==",
        VITE_GOOGLE_MAPS_API_KEY: "AIzaSyDe3GaC52SlaWDAFgFgod6Pwa1xZ0Lfw9o",
        ADMARK_API_KEY: "f14bbabd-3245-44e3-ad2a-0ef632747400",
        ADMARK_PHONE_NUMBER_ID: "1103117459561700",
        RAZORPAY_KEY_ID: "rzp_live_T50Ny5Ok8wBo6y",
        RAZORPAY_KEY_SECRET: "AWBbIhzhOj218hqVpP3taBkH",
        RAZORPAY_WEBHOOK_SECRET: "YSM62QGp_kyqNd2"
      }
    }
  ]
};
