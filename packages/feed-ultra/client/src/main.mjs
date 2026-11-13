/** feedUltra client plugin: locale, scoped styles, the sidebar entry, and the panel. */

import { createElement } from 'react';
import en from '../../locale/en.json';
import zh from '../../locale/zh.json';
import { CLIENT_CONTRIBUTION, createApi } from './api.mjs';
import { PanelIcon } from './icons.mjs';
import { FeedUltraPanel } from './panel.mjs';
import { createReadingMemory } from './reading-memory.mjs';
import { createSettingsApi } from './settings-api.mjs';
import CSS from './styles.css';

const NAMESPACE = 'feedUltra';
const PANEL_ID = 'feedUltra';
const MOUNT_TIMEOUT_MS = 3000;
const SETTINGS_TIMEOUT_MS = 1500;

/**
 * Resolve a mounted Remote namespace through an injected context. Cordis
 * refuses `ctx.remote.<name>` on a context that did not declare the
 * dependency, so the namespace object is read inside `ctx.inject`.
 * @param ctx - plugin context that mounted the contribution.
 * @param name - dotted service path such as `remote.feedUltra`.
 * @param timeoutMs - reject/resolve null when the namespace never appears.
 * @returns value-level namespace, or null when the dependency stays absent.
 */
function mountNamespace(ctx, name, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => (name === 'remote.feedUltra'
        ? reject(new Error('feedUltra Remote namespace did not mount'))
        : resolve(null)),
      timeoutMs,
    );
    try {
      ctx.inject([name], (remoteCtx) => {
        clearTimeout(timer);
        const value = name.split('.').reduce((node, key) => (node ? node[key] : undefined), remoteCtx);
        if (name === 'remote.feedUltra' && !value) {
          reject(new Error('feedUltra Remote namespace did not mount'));
          return () => {};
        }
        resolve(value ?? null);
        return () => {};
      });
    } catch (error) {
      clearTimeout(timer);
      if (name === 'remote.feedUltra') reject(error);
      else resolve(null);
    }
  });
}

function mountApi(ctx) {
  return mountNamespace(ctx, 'remote.feedUltra', MOUNT_TIMEOUT_MS)
    .then(namespace => createApi(namespace));
}

export default {
  inject: ['slots', 'layout', 'sidebarRight', 'sidebarRightTabs', 'workspaces', 'remote', 'locale', 'uiWorkspace', 'theme'],
  async apply(ctx) {
    ctx.effect(
      () => ctx.locale.register(NAMESPACE, { zh, en, 'zh-CN': zh, 'en-US': en }),
      'feedUltra locale',
    );
    const text = ctx.locale.bind(NAMESPACE);

    ctx.effect(() => {
      const style = document.createElement('style');
      style.setAttribute('data-dsh-feed-ultra-style', '');
      style.textContent = CSS;
      document.head.append(style);
      return () => style.remove();
    }, 'feedUltra styles');

    let api;
    try {
      await ctx.remote.$mount(CLIENT_CONTRIBUTION);
      api = await mountApi(ctx);
    } catch (error) {
      console.error('[dsh-feed-ultra] remote mount failed:', error);
      return;
    }

    const readingMemory = createReadingMemory();
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 16, locale: NAMESPACE, label: () => text('entry') },
      iconProps => createElement(PanelIcon, iconProps),
    ));
    let settingsApi = null;
    let settingsAttempt = null;
    const ensureSettings = () => {
      if (settingsApi) return Promise.resolve(settingsApi);
      if (!settingsAttempt) {
        settingsAttempt = mountNamespace(ctx, 'remote.settings', SETTINGS_TIMEOUT_MS)
          .then((namespace) => {
            settingsAttempt = null;
            if (namespace) settingsApi = createSettingsApi(namespace);
            return settingsApi;
          });
      }
      return settingsAttempt;
    };
    void ensureSettings();

    ctx.slots.inject('main', () => ctx.slots.register(
      { name: 'main', key: PANEL_ID },
      () => createElement(FeedUltraPanel, { ctx, api, text, ensureSettings, readingMemory }),
    ));
  },
};
