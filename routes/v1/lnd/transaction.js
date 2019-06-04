const express = require('express');
const router = express.Router();
const validator = require('utils/validator.js');
const lightningLogic = require('logic/lightning.js');
const auth = require('middlewares/auth.js');
const safeHandler = require('utils/safeHandler');

router.post('/', auth.jwt, safeHandler((req, res, next) => {

  const addr = req.body.addr;
  const amt = req.body.amt;
  const satPerByte = req.body.satPerByte;

  try {
    // TODO: addr
    validator.isPositiveInteger(amt);
    if (satPerByte) {
      validator.isPositiveInteger(satPerByte);
    }
  } catch (error) {
    return next(error);
  }

  return lightningLogic.sendCoins(addr, amt, satPerByte)
    .then(transaction => res.json(transaction));
}));

router.post('/when-available', auth.jwt, safeHandler((req, res, next) => {

  const addr = req.body.addr;
  const amt = req.body.amt;
  const satPerByte = req.body.satPerByte;

  try {
    // TODO: addr
    validator.isPositiveInteger(amt);
    if (satPerByte) {
      validator.isPositiveInteger(satPerByte);
    }
  } catch (error) {
    return next(error);
  }

  return lightningLogic.sendCoinsWhenAvailable(addr, amt, satPerByte)
    .then(res.json({}));
}));

router.delete('/when-available', auth.jwt, safeHandler((req, res) =>
  lightningLogic.cancelSendCoinsWhenAvailable()
    .then(res.json({}))
));

router.get('/', auth.jwt, safeHandler((req, res) =>
  lightningLogic.getOnChainTransactions()
    .then(transactions => res.json(transactions))
));

module.exports = router;
