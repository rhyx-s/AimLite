import './styles.css';
import { MemoryBridge } from './bridge/memory';
import { isNative, NativeBridge } from './bridge/native';
import { App } from './ui/app';
import { h } from './ui/dom';
import { errorMessage, Store } from './ui/store';

async function start(): Promise<void> {
  const root = document.getElementById('app')!;
  const bridge = isNative() ? new NativeBridge() : new MemoryBridge();
  const store = new Store(bridge);
  try {
    await store.load();
  } catch (e) {
    root.append(h('div', { class: 'fatal', role: 'alert' },
      h('h1', { text: 'AimLite could not open its data' }),
      h('p', { text: errorMessage(e) }),
      h('p', { text: 'Nothing was deleted. Check that your user account can write the AimLite data folder, then restart. Help: see USER-GUIDE.md → Troubleshooting.' })));
    return;
  }
  const app = new App(root, store);
  app.go({ name: 'modes' });
  window.addEventListener('beforeunload', () => { void store.flushSettings(); });
}

void start();
