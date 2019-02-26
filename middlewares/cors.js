const whitelist = [
  'http://casa-node.local', 
  'http://debug.keys.casa', 
  'chrome-extension://lnaedehiikghclgaikolambpbpeknpef', 
  process.env.DEVICE_HOST
];

const corsOptions = {
  origin: function(origin, callback) {
    if (whitelist.indexOf(origin) !== -1 || !origin) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  }
};

module.exports = {
  corsOptions,
};
