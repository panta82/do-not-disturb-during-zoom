#!/usr/bin/env node

const childProcess = require('child_process');

/**
 * This will be true if we have muted notifications. It means we have to unmute them at some point.
 */
let muted = false;

/**
 * ID of the wait timeout, so we can interrupt.
 */
let waitId = null;

/**
 * Flag used to synchronize clean exit
 */
let stopSignal = false;

process.once('SIGINT', onExit);
process.once('SIGTERM', onExit);

updateLoop().catch(onFatalError);

// *********************************************************************************************************************

function onFatalError(err) {
  console.error(err);
  process.exit(1);
}

async function exec(cmd) {
  return new Promise((resolve, reject) => {
    childProcess.exec(cmd, {
      encoding: 'utf8'
    }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        if (stderr) {
          console.warn(stderr);
        }
        resolve(stdout);
      }
    });
  });
}

async function wait(delay) {
  return new Promise(resolve => {
    waitId = setTimeout(resolve, delay);
  });
}

async function getDoNotDisturbState() {
  const result = await exec('xfconf-query -c xfce4-notifyd -p /do-not-disturb');
  return result.toLowerCase() === 'true';
}

async function setDoNotDisturbState(value) {
  const result = await exec('xfconf-query -c xfce4-notifyd -p /do-not-disturb -s ' + (!!value));
}

async function isZoomMeetingOn() {
  const out = await exec('xwininfo -root -tree');
  const isZoomMeetingOn = /^\s+0x\S+\s+"Zoom Meeting"/m.test(out);
  return isZoomMeetingOn;
}

async function showNotification(title, message, duration = 10000) {
  await exec(`notify-send -t ${duration} "${title.replace(/"/g, '\\"')}" "${message.replace(/"/g, '\\"')}"`);
}

async function update() {
  process.stdout.write('.');

  const shouldBeMuted = await isZoomMeetingOn();
  
  if (!shouldBeMuted && muted) {
    // Unmute
    await setDoNotDisturbState(false);
    await showNotification('Notifications unmuted', 'Do-not-disturb mode deactivated, you will receive notifications again.');
    muted = false;
    console.log('\nUnmuted notifications');
    return;
  }
  
  if (shouldBeMuted && !muted) {
    // We should mute. But lets check if user has disabled notifications on their own.
    const userAlreadyMuted = await getDoNotDisturbState();
    if (userAlreadyMuted) {
      // Nothing else needs to be done
      return;
    }
    
    muted = true;
    await setDoNotDisturbState(true);
    await showNotification('Notifications muted', 'Do-not-disturb mode activated during your Zoom call.');
    console.log('\nMuted notifications');
    return;
  }
  
  // Nothing else needs to be done
}

async function updateLoop() {
  while (!stopSignal) {
    try {
      await update();
    }
    catch (err) {
      console.error(`Update failed: ${err.message || err}`);
      console.error(err.stack);
    }
    if (stopSignal) {
      break;
    }
    await wait(1000);
  }
  await cleanExit();
}

async function cleanExit() {
  if (muted) {
    await setDoNotDisturbState(false);
  }
  process.exit(0);
}

function onExit() {
  stopSignal = true;
  clearTimeout(waitId);
}