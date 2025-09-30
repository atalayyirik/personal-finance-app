'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ACTION = process.argv[2] || 'help';
const LABEL = 'com.personalfinance.reporter';
const HOME = os.homedir();
const PLIST_DIR = path.join(HOME, 'Library', 'LaunchAgents');
const LOG_DIR = path.join(HOME, 'Library', 'Logs', 'personal-finance');
const PLIST_PATH = path.join(PLIST_DIR, `${LABEL}.plist`);

const repoRoot = path.resolve(__dirname, '..', '..');
const headlessScript = path.resolve(repoRoot, 'electron-app', 'scripts', 'reporter-headless.js');
const nodePath = process.execPath; // current node binary

function ensureDirs() {
  fs.mkdirSync(PLIST_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function writePlist() {
  const stdoutPath = path.join(LOG_DIR, 'reporter.out.log');
  const stderrPath = path.join(LOG_DIR, 'reporter.err.log');
  const userDataPath = path.join(repoRoot, 'electron-app', '.user-data');

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${nodePath}</string>
      <string>${headlessScript}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>${repoRoot}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>WORKBENCH_USER_DATA</key>
      <string>${userDataPath}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${stdoutPath}</string>
    <key>StandardErrorPath</key>
    <string>${stderrPath}</string>
  </dict>
</plist>`;

  fs.writeFileSync(PLIST_PATH, plist, 'utf-8');
}

function runLaunchctl(...args) {
  const res = spawnSync('launchctl', args, { encoding: 'utf-8' });
  if (res.error) throw res.error;
  return res;
}

function install() {
  ensureDirs();
  writePlist();
  // unload first if already loaded
  runLaunchctl('unload', PLIST_PATH);
  const out = runLaunchctl('load', '-w', PLIST_PATH);
  console.log('[launchd] installed and loaded:', PLIST_PATH);
  if (out.stderr) console.error(out.stderr.trim());
}

function uninstall() {
  try { runLaunchctl('unload', '-w', PLIST_PATH); } catch (_) {}
  try { fs.unlinkSync(PLIST_PATH); } catch (_) {}
  console.log('[launchd] unloaded and removed:', PLIST_PATH);
}

function status() {
  const exists = fs.existsSync(PLIST_PATH);
  console.log('plist:', exists ? 'present' : 'missing', '-', PLIST_PATH);
  if (!exists) return;
  const out = runLaunchctl('print', `gui/${process.getuid()}/${LABEL}`);
  console.log(out.stdout || out.stderr);
}

switch (ACTION) {
  case 'install':
    install();
    break;
  case 'uninstall':
    uninstall();
    break;
  case 'status':
    status();
    break;
  default:
    console.log('Usage: node scripts/launchd.js <install|uninstall|status>');
    process.exit(2);
}

