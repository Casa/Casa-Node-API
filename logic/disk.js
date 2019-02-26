const constants = require('utils/const.js');
const diskService = require('services/disk');

function readPendingSendCoinsFile() {
  return diskService.readJsonFile(constants.PENDING_SEND_COINS_FILE)
    .catch(() => Promise.resolve({active: false, data: {}}));
}

function readManagedChannelsFile() {
  return diskService.readJsonFile(constants.MANAGED_CHANNELS_FILE)
    .catch(() => Promise.resolve({}));
}

function writeManagedChannelsFile(data) {
  return diskService.writeJsonFile(constants.MANAGED_CHANNELS_FILE, data);
}

function writePendingSendCoinsFile(data) {
  return diskService.writeJsonFile(constants.PENDING_SEND_COINS_FILE, data);
}

module.exports = {
  readManagedChannelsFile,
  readPendingSendCoinsFile,
  writeManagedChannelsFile,
  writePendingSendCoinsFile
};
