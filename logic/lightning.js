/**
 * All Lightning business logic.
 */

/* eslint-disable id-length, max-lines, max-statements */

const logger = require('utils/logger.js');
var LndError = require('models/errors.js').LndError;

const diskLogic = require('logic/disk');
const bitcoindLogic = require('logic/bitcoind.js');
const constants = require('utils/const.js');

const lndService = require('services/lnd.js');

const SEND_COINS_WHEN_AVAILABLE_INTERVAL_IN_SECONDS = 30;
const MILLI_SECONDS = 1000;
const UNIMPLEMENTED_CODE = 12;

const PENDING_OPEN_CHANNELS = 'pendingOpenChannels';
const PENDING_CLOSING_CHANNELS = 'pendingClosingChannels';
const PENDING_FORCE_CLOSING_CHANNELS = 'pendingForceClosingChannels';
const WAITING_CLOSE_CHANNELS = 'waitingCloseChannels';
const PENDING_CHANNEL_TYPES = [PENDING_OPEN_CHANNELS, PENDING_CLOSING_CHANNELS, PENDING_FORCE_CLOSING_CHANNELS,
  WAITING_CLOSE_CHANNELS];

const MAINNET_GENESIS_BLOCK_TIMESTAMP = 1231035305;
const TESTNET_GENESIS_BLOCK_TIMESTAMP = 1296717402;

const FAST_BLOCK_CONF_TARGET = 1;
const NORMAL_BLOCK_CONF_TARGET = 6;
const SLOW_BLOCK_CONF_TARGET = 24;
const CHEAPEST_BLOCK_CONF_TARGET = 144;

const OPEN_CHANNEL_EXTRA_WEIGHT = 10;

const INSUFFICIENT_FUNDS_ERROR = {
  code: 'INSUFFICIENT_FUNDS',
  text: 'Lower amount or increase confirmation target.'
};

const INVALID_ADDRESS = {
  code: 'INVALID_ADDRESS',
  text: 'Please validate the Bitcoin address is correct.'
};

const OUTPUT_IS_DUST_ERROR = {
  code: 'OUTPUT_IS_DUST',
  text: 'Transaction output is dust.'
};

// Creates a new invoice; more commonly known as a payment request.
function addInvoice(amt, memo) {
  return lndService.addInvoice(amt, memo);
}

// Creates a new managed channel.
async function addManagedChannel(channelPoint, name, purpose) {
  const managedChannels = await getManagedChannels();

  // Create a new managed channel. If one exists, it will be rewritten.
  // However, Lnd should guarantee chanId is always unique.
  managedChannels[channelPoint] = {
    name: name, // eslint-disable-line object-shorthand
    purpose: purpose, // eslint-disable-line object-shorthand
  };

  await setManagedChannels(managedChannels);
}

// Cancels any existing send coins loops.
function cancelSendCoinsWhenAvailable() {
  return setPendingCoins(false, {});
}

// Closes the channel that corresponds to the given channelPoint. Force close is optional.
async function closeChannel(txHash, index, force) {
  return await lndService.closeChannel(txHash, index, force);
}

// Decode the payment request into useful information.
function decodePaymentRequest(paymentRequest) {
  return lndService.decodePaymentRequest(paymentRequest);
}

// Estimate the cost of opening a channel. We do this by repurposing the existing estimateFee grpc route from lnd. We
// generate our own unused address and then feed that into the existing call. Then we add an extra 10 sats per
// feerateSatPerByte. This is because the actual cost is slightly more than the default one output estimate.
async function estimateChannelOpenFee(amt, confTarget) {
  const address = (await generateAddress()).address;
  const baseFeeEstimate = await estimateFee(address, amt, confTarget, false);

  if (confTarget === 0) {
    const keys = Object.keys(baseFeeEstimate);

    for (const key of keys) {

      if (baseFeeEstimate[key].feeSat) {
        baseFeeEstimate[key].feeSat = String(parseInt(baseFeeEstimate[key].feeSat, 10) + OPEN_CHANNEL_EXTRA_WEIGHT
          * baseFeeEstimate[key].feerateSatPerByte);
      }

    }

  } else if (baseFeeEstimate.feeSat) {
    baseFeeEstimate.feeSat = String(parseInt(baseFeeEstimate.feeSat, 10) + OPEN_CHANNEL_EXTRA_WEIGHT
      * baseFeeEstimate.feerateSatPerByte);
  }

  return baseFeeEstimate;
}

// Estimate an on chain transaction fee.
async function estimateFee(address, amt, confTarget, sweep) {

  if (sweep) {

    const utxos = (await lndService.listUnspent()).utxos;
    const balance = parseInt((await lndService.getWalletBalance()).totalBalance, 10);

    utxos.sort(compareUtxo);

    var amtToEstimate = balance + 1;

    // We start to estimate a fee by forcing the estimate amount to use the maximum amount of utxos. If that fails, we
    // subtract the next smallest utxo until we run out of utxos. If we run out of utxos, that means we are unable to
    // create a transaction for the given confirmation target.
    for (const utxo of utxos) {
      amtToEstimate -= utxo.amountSat;

      try {
        if (confTarget === 0) {
          return await estimateFeeGroup(address, amtToEstimate);
        } else {
          return await lndService.estimateFee(address, amtToEstimate, confTarget);
        }
      } catch (error) {
        // no op
      }
    }

    return INSUFFICIENT_FUNDS_ERROR;
  } else {

    try {
      if (confTarget === 0) {
        return await estimateFeeGroup(address, amt);
      } else {
        return await lndService.estimateFee(address, amt, confTarget);
      }
    } catch (error) {
      return handleEstimateFeeError(error);
    }
  }
}

async function estimateFeeGroup(address, amt) {
  const calls = [lndService.estimateFee(address, amt, FAST_BLOCK_CONF_TARGET),
    lndService.estimateFee(address, amt, NORMAL_BLOCK_CONF_TARGET),
    lndService.estimateFee(address, amt, SLOW_BLOCK_CONF_TARGET),
    lndService.estimateFee(address, amt, CHEAPEST_BLOCK_CONF_TARGET),
  ];

  const [fast, normal, slow, cheapest]
    = await Promise.all(calls.map(p => p.catch(error => handleEstimateFeeError(error))));

  return {
    fast: fast, // eslint-disable-line object-shorthand
    normal: normal, // eslint-disable-line object-shorthand
    slow: slow, // eslint-disable-line object-shorthand
    cheapest: cheapest, // eslint-disable-line object-shorthand
  };
}

function handleEstimateFeeError(error) {
  if (error.error.details === 'transaction output is dust') {
    return OUTPUT_IS_DUST_ERROR;
  } else if (error.error.details === 'insufficient funds available to construct transaction') {
    return INSUFFICIENT_FUNDS_ERROR;
  }

  return INVALID_ADDRESS;
}

function compareUtxo(a, b) {
  if (parseInt(a.amountSat, 10) < parseInt(b.amountSat, 10)) {
    return -1;
  }
  if (parseInt(a.amountSat, 10) > parseInt(b.amountSat, 10)) {
    return 1;
  }

  return 0;
}

// Generates a new on chain segwit bitcoin address.
async function generateAddress() {
  return await lndService.generateAddress();
}

// Generates a new 24 word seed phrase.
async function generateSeed() {

  const lndStatus = await getStatus();

  if (lndStatus.operational) {
    const response = await lndService.generateSeed();

    return {seed: response.cipherSeedMnemonic};
  }

  throw new LndError('Lnd is not operational, therefor a seed cannot be created.');
}

// Returns the total funds in channels and the total pending funds in channels.
function getChannelBalance() {
  return lndService.getChannelBalance();
}

// Returns a count of all open channels.
function getChannelCount() {
  return lndService.getOpenChannels()
    .then(response => ({count: response.length}));
}

function getForwardingEvents(startTime, endTime, indexOffset) {
  return lndService.getForwardingEvents(startTime, endTime, indexOffset);
}

// Returns a list of all invoices.
async function getInvoices() {
  const invoices = await lndService.getInvoices();

  const reversedInvoices = [];
  for (const invoice of invoices.invoices) {
    reversedInvoices.unshift(invoice);
  }

  return reversedInvoices;
}

// Return all managed channels. Managed channels are channels the user has manually created.
// TODO: how to handle if file becomes corrupt? Suggest simply wiping the file. The channel will still exist.
function getManagedChannels() {
  return diskLogic.readManagedChannelsFile();
}

// Returns a list of all on chain transactions.
async function getOnChainTransactions() {
  const transactions = await lndService.getOnChainTransactions();
  const openChannels = await lndService.getOpenChannels();
  const closedChannels = await lndService.getClosedChannels();
  const pendingChannelRPC = await lndService.getPendingChannels();

  const pendingChannelTransactions = [];

  for (const pendingGroup of [
    pendingChannelRPC.pendingOpenChannels,
    pendingChannelRPC.pendingClosingChannels,
    pendingChannelRPC.pendingForceClosingChannels,
    pendingChannelRPC.waitingCloseChannels]) {

    if (pendingGroup.length === 0) {
      continue;
    }
    for (const pendingChannel of pendingGroup) {
      const pendingTransaction = pendingChannel.channel.channelPoint.split(':').shift();
      pendingChannelTransactions.push(pendingTransaction);
    }
  }

  const openingChannelTransactions = [];
  for (const channel of openChannels) {
    const openingTransaction = channel.channelPoint.split(':').shift();
    openingChannelTransactions.push(openingTransaction);
  }

  const closingChannelTransactions = [];
  for (const channel of closedChannels) {
    const closingTransaction = channel.channelPoint.split(':').shift();
    closingChannelTransactions.push(closingTransaction);
  }

  const reversedTransactions = [];
  for (const transaction of transactions) {
    const txHash = transaction.txHash;

    if (openingChannelTransactions.includes(txHash)) {
      transaction.type = 'CHANNEL_OPEN';
    } else if (closingChannelTransactions.includes(txHash)) {
      transaction.type = 'CHANNEL_CLOSE';
    } else if (pendingChannelTransactions.includes(txHash)) {
      transaction.type = 'CHANNEL_PENDING';
    } else if (transaction.amount < 0) {
      transaction.type = 'ON_CHAIN_TRANSACTION_SENT';
    } else if (transaction.amount > 0) {
      transaction.type = 'ON_CHAIN_TRANSACTION_RECEIVED';
    } else {
      transaction.type = 'UNKNOWN';
    }

    reversedTransactions.unshift(transaction);
  }

  return reversedTransactions;
}

function getTxnHashFromChannelPoint(channelPoint) {
  return channelPoint.split(':')[0];
}

// Returns a list of all open channels.
const getChannels = async() => {
  const managedChannelsCall = getManagedChannels();
  const openChannelsCall = lndService.getOpenChannels();
  const pendingChannels = await lndService.getPendingChannels();

  const allChannels = [];

  // Combine all pending channel types
  for (const channel of pendingChannels.waitingCloseChannels) {
    channel.type = 'WAITING_CLOSING_CHANNEL';
    allChannels.push(channel);
  }

  for (const channel of pendingChannels.pendingForceClosingChannels) {
    channel.type = 'FORCE_CLOSING_CHANNEL';
    allChannels.push(channel);
  }

  for (const channel of pendingChannels.pendingClosingChannels) {
    channel.type = 'PENDING_CLOSING_CHANNEL';
    allChannels.push(channel);
  }

  for (const channel of pendingChannels.pendingOpenChannels) {
    channel.type = 'PENDING_OPEN_CHANNEL';

    // Make our best guess as to if this channel was created by us.
    if (channel.channel.remoteBalance === '0') {
      channel.initiator = true;
    } else {
      channel.initiator = false;
    }

    allChannels.push(channel);
  }

  // If we have any pending channels, we need to call get chain transactions to determine how many confirmations are
  // left for each pending channel. This gets the entire history of on chain transactions.
  // TODO: Once pagination is available, we should develop a different strategy.
  let chainTxnCall = null;
  let chainTxns = null;
  if (allChannels.length > 0) {
    chainTxnCall = lndService.getOnChainTransactions();
  }

  // Combine open channels
  const openChannels = await openChannelsCall;

  for (const channel of openChannels) {
    channel.type = 'OPEN';
    allChannels.push(channel);
  }

  // Add additional managed channel data if it exists
  // Call this async, because it reads from disk
  const managedChannels = await managedChannelsCall;

  if (chainTxnCall !== null) {
    const chainTxnList = await chainTxnCall;

    // Convert list to object for efficient searching
    chainTxns = {};
    for (const txn of chainTxnList) {
      chainTxns[txn.txHash] = txn;
    }
  }

  // Iterate through all channels
  for (const channel of allChannels) {

    // Pending channels have an inner channel object.
    if (channel.channel) {
      // Use remotePubkey for consistency with open channels
      channel.remotePubkey = channel.channel.remoteNodePub;
      channel.channelPoint = channel.channel.channelPoint;
      channel.capacity = channel.channel.capacity;
      channel.localBalance = channel.channel.localBalance;
      channel.remoteBalance = channel.channel.remoteBalance;

      delete channel.channel;

      // Determine the number of confirmation remaining for this channel

      // We might have invalid channels that dne in the onChainTxList. Skip these channels
      const knownChannel = chainTxns[getTxnHashFromChannelPoint(channel.channelPoint)];
      if (!knownChannel) {
        channel.managed = false;
        channel.name = '';
        channel.purpose = '';

        continue;
      }
      const numConfirmations = knownChannel.numConfirmations;

      if (channel.type === 'FORCE_CLOSING_CHANNEL') {

        // BlocksTilMaturity is provided by Lnd for forced closing channels once they have one confirmation
        channel.remainingConfirmations = channel.blocksTilMaturity;
      } else if (channel.type === 'PENDING_CLOSING_CHANNEL') {

        // Lnd seams to be clearing these channels after just one confirmation and thus they never exist in this state.
        // Defaulting to 1 just in case.
        channel.remainingConfirmations = 1;
      } else if (channel.type === 'PENDING_OPEN_CHANNEL') {

        channel.remainingConfirmations = constants.LN_REQUIRED_CONFIRMATIONS - numConfirmations;
      }
    }

    // If a managed channel exists, set the name and purpose
    if (Object.prototype.hasOwnProperty.call(managedChannels, channel.channelPoint)) {
      channel.managed = true;
      channel.name = managedChannels[channel.channelPoint].name;
      channel.purpose = managedChannels[channel.channelPoint].purpose;
    } else {
      channel.managed = false;
      channel.name = '';
      channel.purpose = '';
    }
  }

  return allChannels;
};

// Returns a list of all outgoing payments.
async function getPayments() {
  const payments = await lndService.getPayments();

  const reversedPayments = [];
  for (const payment of payments.payments) {
    reversedPayments.unshift(payment);
  }

  return reversedPayments;
}

// Returns the full channel details of a pending channel.
async function getPendingChannelDetails(channelType, pubKey) {
  const pendingChannels = await getPendingChannels();

  // make sure correct type is used
  if (!PENDING_CHANNEL_TYPES.includes(channelType)) {
    throw Error('unknown pending channel type: ' + channelType);
  }

  const typePendingChannel = pendingChannels[channelType];

  for (let index = 0; index < typePendingChannel.length; index++) {
    const curChannel = typePendingChannel[index];
    if (curChannel.channel && curChannel.channel.remoteNodePub && curChannel.channel.remoteNodePub === pubKey) {
      return curChannel.channel;
    }
  }

  throw new Error('Could not find a pending channel for pubKey: ' + pubKey);
}

// Returns a list of all pending channels.
function getPendingChannels() {
  return lndService.getPendingChannels();
}

// Returns all associated public uris for this node.
function getPublicUris() {
  return lndService.getInfo()
    .then(info => info.uris);
}

function getGeneralInfo() {
  return lndService.getInfo();
}

// Returns the status on lnd syncing to the current chain.
// LND info returns "best_header_timestamp" from getInfo which is the timestamp of the latest Bitcoin block processed
// by LND. Using known date of the genesis block to roughly calculate a percent processed.
async function getSyncStatus() {
  const info = await lndService.getInfo();

  let percentSynced = null;
  let processedBlocks = null;

  if (!info.syncedToChain) {
    const genesisTimestamp = info.testnet ? TESTNET_GENESIS_BLOCK_TIMESTAMP : MAINNET_GENESIS_BLOCK_TIMESTAMP;

    const currentTime = Math.floor(new Date().getTime() / 1000); // eslint-disable-line no-magic-numbers

    percentSynced = ((info.bestHeaderTimestamp - genesisTimestamp) / (currentTime - genesisTimestamp))
      .toFixed(4); // eslint-disable-line no-magic-numbers

    // let's not return a value over the 100% or processedBlocks > blockHeight
    // space-fleet can determine how to handle this error state if it detects -1
    if (percentSynced < 1.0) {
      processedBlocks = Math.floor(percentSynced * info.blockHeight);
    } else {
      processedBlocks = -1;
      percentSynced = -1;
    }

  } else {
    percentSynced = (1).toFixed(4); // eslint-disable-line no-magic-numbers
    processedBlocks = info.blockHeight;
  }

  return {
    percent: percentSynced,
    knownBlockCount: info.blockHeight,
    processedBlocks: processedBlocks, // eslint-disable-line object-shorthand
  };
}

// Returns the wallet balance and pending confirmation balance.
function getWalletBalance() {
  return lndService.getWalletBalance();
}

// Creates and initialized a Lightning wallet.
async function initializeWallet(password, seed) {

  const lndStatus = await getStatus();

  if (lndStatus.operational) {

    await lndService.initWallet({
      mnemonic: seed,
      password: password // eslint-disable-line object-shorthand
    });

    return;
  }

  throw new LndError('Lnd is not operational, therefor a wallet cannot be created.');
}

// Opens a channel to the node with the given public key with the given amount.
async function openChannel(pubKey, ip, port, amt, satPerByte, name, purpose) { // eslint-disable-line max-params

  var peers = await lndService.getPeers();

  var existingPeer = false;

  for (const peer of peers) {
    if (peer.pubKey === pubKey) {
      existingPeer = true;
      break;
    }
  }

  if (!existingPeer) {
    await lndService.connectToPeer(pubKey, ip, port);
  }

  // only returns a transactions id
  // TODO: Can we get the channel index from here? The channel point is transaction id:index. It could save us a call
  // to pendingChannelDetails.
  const channel = await lndService.openChannel(pubKey, amt, satPerByte);

  // Lnd only allows one channel to be created with a node per block. By searching pending open channels, we can find
  // a unique identifier for the newly created channe. We will use ChannelPoint.
  const pendingChannel = await getPendingChannelDetails(PENDING_OPEN_CHANNELS, pubKey);
  await addManagedChannel(pendingChannel.channelPoint, name, purpose);

  return channel;
}

// Pays the given invoice.
async function payInvoice(paymentRequest, amt) {
  const invoice = await decodePaymentRequest(paymentRequest);

  if (invoice.numSatoshis !== '0' && amt) { // numSatoshis is returned from lnd as a string
    throw Error('Payment Request with non zero amount and amt value supplied.');
  }

  if (invoice.numSatoshis === '0' && !amt) { // numSatoshis is returned from lnd as a string
    throw Error('Payment Request with zero amount requires an amt value supplied.');
  }

  return await lndService.sendPaymentSync(paymentRequest, amt);
}

// Removes a managed channel.
// TODO: Figure out when an appropriate time to cleanup closed managed channel data. We need it during the closing
// process to display to users.
/*
async function removeManagedChannel(fundingTxId, index) {
  const managedChannels = await getManagedChannels();

  const channelPoint = fundingTxId + ':' + index;

  if (Object.prototype.hasOwnProperty.call(managedChannels, channelPoint)) {
    delete managedChannels[channelPoint];
  }

  return await setManagedChannels(managedChannels);
}
*/

// Send bitcoins on chain to the given address with the given amount. Sats per byte is optional.
function sendCoins(addr, amt, satPerByte, sendAll) {

  // Lnd requires we ignore amt if sendAll is true.
  if (sendAll) {
    return lndService.sendCoins(addr, undefined, satPerByte, sendAll);
  }

  return lndService.sendCoins(addr, amt, satPerByte, sendAll);
}

// Sets the managed channel data store.
// TODO: How to prevent this from getting out of data with multiple calling threads?
// perhaps create a mutex for reading and writing?
function setManagedChannels(managedChannelsObject) {
  return diskLogic.writeManagedChannelsFile(managedChannelsObject);
}

async function attemptSendCoins() {
  const pendingSendCoins = await getPendingSendCoins();
  if (!pendingSendCoins.active) {
    return;
  }

  try {
    await lndService
      .sendCoins(pendingSendCoins.data.addr, pendingSendCoins.data.amt, pendingSendCoins.data.satPerByte);
    await setPendingCoins(false, {});
  } catch (error) {
    // TODO this may need more attention - will try indefinitely
    logger.error('Unable to send funds', 'transaction', error);
    setTimeout(attemptSendCoins, SEND_COINS_WHEN_AVAILABLE_INTERVAL_IN_SECONDS * MILLI_SECONDS);
  }
}

// Sets the current state of pending coins and begins the send coins loop.
function setPendingCoins(active, data) {
  return diskLogic.writePendingSendCoinsFile({active, data})
    .then(() => {
      attemptSendCoins(); // Don't chain/wait this promise, it's designed to run and loop in the background
    });
}

// Returns if lnd is operation and if the wallet is unlocked.
async function getStatus() {
  const bitcoindStatus = await bitcoindLogic.getStatus();

  // lnd requires bitcoind to be operational.
  if (!bitcoindStatus.operational) {

    return {
      operational: false,
      unlocked: false
    };
  }

  try {
    // The getInfo function requires that the wallet be unlocked in order to succeed. Lnd requires this for all
    // encrypted wallets.
    await lndService.getInfo();

    return {
      operational: true,
      unlocked: true
    };
  } catch (error) {

    // lnd might be active, but not possible to contact
    // using RPC if the wallet is encrypted. If we get
    // error code Unimplemented, it means that lnd is
    // running, but the RPC server is not active yet (only
    // WalletUnlocker server active) and most likely this
    // is because of an encrypted wallet.
    if (error instanceof LndError) {

      if (error.error && error.error.code === UNIMPLEMENTED_CODE) {

        return {
          operational: true,
          unlocked: false
        };
      }

      return {
        operational: false,
        unlocked: false
      };
    }

    throw error;
  }
}

//  Returns pending send coins object.
function getPendingSendCoins() {
  return diskLogic.readPendingSendCoinsFile();
}

// Create a loop that tries to send coins to a specified address every time interval. This loop will remain until
// send coins has completed successfully or when canceled.
async function sendCoinsWhenAvailable(addr, amt, satPerByte) {
  const pendingSendCoins = await getPendingSendCoins();

  if (pendingSendCoins.active) {
    throw new LndError(
      'There is already a withdraw in progress. Please cancel it or wait for it to complete.',
      'WITHDRAW_ALREADY_IN_PROGRESS');
  }
  await setPendingCoins(true, {
    addr: addr, // eslint-disable-line object-shorthand
    amt: amt, // eslint-disable-line object-shorthand
    satPerByte: satPerByte // eslint-disable-line object-shorthand
  });
}

// Unlock and existing wallet.
async function unlockWallet(password) {
  const lndStatus = await getStatus();

  if (lndStatus.operational) {
    try {
      await lndService.unlockWallet(password);

      return;
    } catch (error) {
      // If it's a command for the UnlockerService (like
      // 'create' or 'unlock') but the wallet is already
      // unlocked, then these methods aren't recognized any
      // more because this service is shut down after
      // successful unlock. That's why the code
      // 'Unimplemented' means something different for these
      // two commands.
      if (error instanceof LndError) {

        // wallet is already unlocked
        if (error.error && error.error.code === UNIMPLEMENTED_CODE) {
          return;
        }
      }

      throw error;
    }
  }

  throw new LndError('Lnd is not operational, therefor the wallet cannot be unlocked.');
}

async function getVersion() {
  const info = await lndService.getInfo();
  const unformattedVersion = info.version;

  // Remove all beta/commit info. Fragile, LND may one day GA.
  const version = unformattedVersion.split('-', 1)[0];

  return {version: version}; // eslint-disable-line object-shorthand
}

module.exports = {
  addInvoice,
  cancelSendCoinsWhenAvailable,
  closeChannel,
  decodePaymentRequest,
  estimateChannelOpenFee,
  estimateFee,
  generateAddress,
  generateSeed,
  getChannelBalance,
  getChannelCount,
  getInvoices,
  getChannels,
  getForwardingEvents,
  getOnChainTransactions,
  getPayments,
  getPendingChannels,
  getPublicUris,
  getStatus,
  getSyncStatus,
  getWalletBalance,
  initializeWallet,
  openChannel,
  payInvoice,
  sendCoins,
  sendCoinsWhenAvailable,
  unlockWallet,
  getGeneralInfo,
  getVersion,
};
