const validator = require('validator');

const ValidationError = require('models/errors.js').ValidationError;

function isAlphanumeric(string) {

  isDefined(string);

  if (!validator.isAlphanumeric(string)) {
    throw new ValidationError('Must include only alpha numeric characters.');
  }
}

function isAlphanumericAndSpaces(string) {

  isDefined(string);

  if (!validator.matches(string, '^[a-zA-Z0-9\\s]*$')) {
    throw new ValidationError('Must include only alpha numeric characters and spaces.');
  }
}

function isPositiveInteger(amount) {
  if (!validator.isInt(amount + '', {gt: 0})) {
    throw new ValidationError('Must be positive integer.');
  }
}

function isPositiveIntegerOrZero(amount) {
  if (!validator.isInt(amount + '', {gt: -1})) {
    throw new ValidationError('Must be positive integer.');
  }
}

function isBoolean(value) {
  if (value !== true && value !== false) {
    throw new ValidationError('Must be true or false.');
  }
}

function isDefined(object) {
  if (object === undefined) {
    throw new ValidationError('Must define variable.');
  }
}

module.exports = {
  isAlphanumeric,
  isAlphanumericAndSpaces,
  isBoolean,
  isPositiveInteger,
  isPositiveIntegerOrZero,
};
