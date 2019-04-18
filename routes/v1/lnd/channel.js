const express = require('express');
const router = express.Router();
const validator = require('utils/validator.js');
const lightningLogic = require('logic/lightning.js');
const auth = require('middlewares/auth.js');
const safeHandler = require('utils/safeHandler');

router.get('/', auth.jwt, safeHandler((req, res) =>
  lightningLogic.getChannels()
    .then(channels => res.json(channels))
));

router.get('/pending', auth.jwt, safeHandler((req, res) =>
  lightningLogic.getPendingChannels()
    .then(channels => res.json(channels))
));

router.delete('/close', auth.jwt, safeHandler((req, res, next) => {

  const channelPoint = req.body.channelPoint;
  const force = req.body.force;

  const parts = channelPoint.split(':');

  if (parts.length !== 2) { // eslint-disable-line no-magic-numbers
    return next(new Error('Invalid channel point: ' + channelPoint));
  }

  var fundingTxId;
  var index;

  try {
    // TODO: fundingTxId, index
    fundingTxId = parts[0];
    index = parseInt(parts[1], 10);

    validator.isBoolean(force);
  } catch (error) {
    return next(error);
  }

  return lightningLogic.closeChannel(fundingTxId, index, force)
    .then(channel => res.json(channel));
}));

router.get('/count', auth.jwt, safeHandler((req, res) =>
  lightningLogic.getChannelCount()
    .then(count => res.json(count))
));

router.post('/open', auth.jwt, safeHandler((req, res, next) => {

  const pubKey = req.body.pubKey;
  const ip = req.body.ip || '127.0.0.1';
  const port = req.body.port || 9735; // eslint-disable-line no-magic-numbers
  const amt = req.body.amt;
  const satPerByte = req.body.satPerByte;
  const name = req.body.name;
  const purpose = req.body.purpose;

  try {

    // TODO validate ip address as ip4 or ip6 address
    validator.isAlphanumeric(pubKey);
    validator.isPositiveInteger(port);
    validator.isPositiveInteger(amt);
    if (satPerByte) {
      validator.isPositiveInteger(satPerByte);
    }
    validator.isAlphanumericAndSpaces(name);
    validator.isAlphanumericAndSpaces(purpose);
  } catch (error) {
    return next(error);
  }

  return lightningLogic.openChannel(pubKey, ip, port, amt, satPerByte, name, purpose)
    .then(channel => res.json(channel));
}));

module.exports = router;
