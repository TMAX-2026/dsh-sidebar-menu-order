/**
 * Browser half of the sidebar menu order plugin.
 *
 * How the reorder works without touching another plugin's code: a sidebar row
 * is one `sidebar.panellist` list registration, and the sidebar shell sorts
 * those registrations by their `order` option. The slot core lets a later
 * registration shadow an earlier one with the same id at a DIFFERENT priority
 * (lowest priority number renders), so this plugin re-registers every panel it
 * should reorder at priority -1, copying the original entry's component,
 * label, locale, and inject face and substituting only `order`. The original
 * registrations stay untouched: disabling this plugin restores the default
 * order, and a panel that disappears disposes its shadow on the next sync.
 *
 * The chosen order is stored in this bundle's Host entry as a volatile Config
 * field, reached through the Client `configForms` service (profile-scoped, so
 * it survives restarts and applies to every browser of the profile). A browser
 * local cache keeps the order usable when that service is unavailable.
 */
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-menu-order',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useRef, useState, useSyncExternalStore } = React;

    const NS = 'sidebarMenuOrder';
    const ENTRY_ID = 'sidebar-menu-order';
    /**
     * Settings namespaces to probe. A bundle-patch row composes inside the
     * profile's include layer, so its entry id is `include:<row>`; a top-level
     * row would use the bare id. Whichever namespace the Host serves is adopted.
     */
    const ENTRY_IDS = [`include:${ENTRY_ID}`, ENTRY_ID];
    const SLOT = 'sidebar.panellist';
    const ACTIONS_SLOT = 'sidebar.panellist.actions';
    const OVERLAY_SLOT = 'shell.overlay';
    /** Priority that shadows an existing list entry; the core renders the lowest number. */
    const SHADOW_PRIORITY = -1;
    /** Spacing between our generated order values. */
    const ORDER_STEP = 10;
    const STORAGE_KEY = 'dsh.sidebar-menu-order.v1';
    const TITLE_ID = 'dsmo-dialog-title';
    /** Opt-in console tracing: localStorage['dsh.sidebar-menu-order.debug'] = '1'. */
    const DEBUG = (() => {
      try {
        return window.localStorage.getItem('dsh.sidebar-menu-order.debug') === '1';
      } catch (error) {
        return false;
      }
    })();
    const debugLog = (...args) => {
      if (DEBUG) console.info('[sidebar-menu-order]', ...args);
    };
    const HINT_ID = 'dsmo-dialog-hint';

    const en = {
      'menu.action': 'Reorder menu…',
      'dialog.title': 'Reorder sidebar menu',
      'dialog.hint': 'Drag a row, or use its arrow buttons. The order also applies to the More menu.',
      'dialog.close': 'Close',
      'dialog.done': 'Done',
      'dialog.reset': 'Restore default order',
      'dialog.moveUp': 'Move {name} up',
      'dialog.moveDown': 'Move {name} down',
      'dialog.saving': 'Saving…',
      'dialog.saved': 'Saved to this profile',
      'dialog.localOnly': 'Saved in this browser only',
      'dialog.failed': 'Not saved: {reason}',
      'dialog.failedGeneric': 'Could not save the new order',
      'dialog.refused': 'the Host refused the write',
      'dialog.modeProfile': 'The order is stored in this profile.',
      'dialog.modeLocal': 'This profile cannot be written; the order stays in this browser.',
      'dialog.empty': 'No reorderable panels are registered right now.',
    };

    const zh = {
      'menu.action': '菜单排序…',
      'dialog.title': '调整侧栏菜单顺序',
      'dialog.hint': '拖动行，或用行上的箭头按钮调整。「更多」菜单也按同一顺序排列。',
      'dialog.close': '关闭',
      'dialog.done': '完成',
      'dialog.reset': '恢复默认顺序',
      'dialog.moveUp': '上移 {name}',
      'dialog.moveDown': '下移 {name}',
      'dialog.saving': '正在保存…',
      'dialog.saved': '已保存到当前 profile',
      'dialog.localOnly': '仅保存在当前浏览器',
      'dialog.failed': '保存失败：{reason}',
      'dialog.failedGeneric': '无法保存新的顺序',
      'dialog.refused': 'Host 拒绝了写入',
      'dialog.modeProfile': '顺序保存到当前 profile',
      'dialog.modeLocal': '当前无法写入 profile，顺序只保存在这个浏览器',
      'dialog.empty': '当前没有可排序的面板入口。',
    };

    /* ---------------------------------------------------------------- *
     * Pure helpers
     * ---------------------------------------------------------------- */

    function readLocalOrder() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
      } catch (error) {
        console.warn('[sidebar-menu-order] reading the local order failed', error);
        return [];
      }
    }

    function writeLocalOrder(order) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
      } catch (error) {
        console.warn('[sidebar-menu-order] writing the local order failed', error);
      }
    }

    function readHostOrder(value) {
      if (value === null || typeof value !== 'object') return [];
      const order = value.order;
      return Array.isArray(order) ? order.filter(id => typeof id === 'string') : [];
    }

    function labelOf(entry, fallback) {
      if (entry === undefined) return fallback;
      const label = entry.options.label;
      try {
        const resolved = typeof label === 'function' ? label() : label;
        return typeof resolved === 'string' && resolved.length > 0 ? resolved : fallback;
      } catch (error) {
        console.warn('[sidebar-menu-order] resolving a panel label failed', error);
        return fallback;
      }
    }

    /** Move `sourceId` before/after `targetId`; returns the unchanged list when nothing moves. */
    function reorderByDrop(ids, sourceId, targetId, after) {
      const from = ids.indexOf(sourceId);
      const target = ids.indexOf(targetId);
      if (from < 0 || target < 0 || sourceId === targetId) return undefined;
      const without = ids.filter(id => id !== sourceId);
      const base = without.indexOf(targetId);
      const to = base + (after ? 1 : 0);
      if (to === from) return undefined;
      const next = without.slice();
      next.splice(to, 0, sourceId);
      return next;
    }

    function moveBy(ids, index, delta) {
      const to = index + delta;
      if (to < 0 || to >= ids.length) return undefined;
      const next = ids.slice();
      const [item] = next.splice(index, 1);
      next.splice(to, 0, item);
      return next;
    }

    function sameIds(a, b) {
      return a.length === b.length && a.every((id, index) => id === b[index]);
    }

    function samePanels(a, b) {
      return a.length === b.length && a.every((panel, index) => panel.id === b[index].id && panel.label === b[index].label);
    }

    function errorMessage(error) {
      if (error instanceof Error && error.message.length > 0) return error.message;
      const text = String(error);
      return text.length > 0 ? text : 'unknown error';
    }

    function trapFocus(event, root) {
      const focusable = [...root.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(node => node.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey) {
        if (document.activeElement === first || document.activeElement === root) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    /* ---------------------------------------------------------------- *
     * Controller: shadow registrations, dialog state, persistence
     * ---------------------------------------------------------------- */

    function createController(ctx, t) {
      const listeners = new Set();
      let snapshot = { open: false, panels: [], status: 'idle', detail: '', storage: 'unknown' };
      let savedOrder = readLocalOrder();
      let shadowDisposers = [];
      let appliedIds = [];
      let appliedEntries = [];
      let queued = false;
      let disposing = false;
      let dirty = false;
      let saveTimer;
      let activeForm = null;
      const formCandidates = [];

      function publish(patch) {
        snapshot = { ...snapshot, ...patch };
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch (error) {
            console.error('[sidebar-menu-order] subscriber failed', error);
          }
        }
      }

      /** Current non-shadow panel registrations, plus the display order they should take. */
      function collect() {
        const byId = new Map();
        for (const entry of ctx.slots.entries(SLOT)) {
          const id = entry.options.id;
          if (typeof id !== 'string' || id.length === 0) continue;
          if ((entry.options.priority ?? 0) === SHADOW_PRIORITY) continue;
          if (!byId.has(id)) byId.set(id, entry);
        }
        const natural = [...byId.keys()];
        const known = new Set(natural);
        const ordered = [];
        for (const id of savedOrder) {
          if (known.has(id) && !ordered.includes(id)) ordered.push(id);
        }
        for (const id of natural) {
          if (!ordered.includes(id)) ordered.push(id);
        }
        return { byId, ordered };
      }

      function disposeShadows() {
        const disposers = shadowDisposers;
        shadowDisposers = [];
        appliedIds = [];
        appliedEntries = [];
        for (const dispose of disposers) {
          try {
            dispose();
          } catch (error) {
            console.error('[sidebar-menu-order] disposing a shadow registration failed', error);
          }
        }
      }

      /**
       * Rebuild budget. Re-registering sidebar entries re-renders the shell; an
       * unforeseen feedback loop must degrade to "order not applied" instead of
       * locking the renderer.
       */
      let rebuildWindowStart = 0;
      let rebuildsInWindow = 0;
      let rebuildPaused = false;
      function allowRebuild() {
        const now = Date.now();
        if (now - rebuildWindowStart > 3000) {
          rebuildWindowStart = now;
          rebuildsInWindow = 0;
        }
        rebuildsInWindow += 1;
        if (rebuildsInWindow <= 20) return true;
        if (!rebuildPaused) {
          rebuildPaused = true;
          console.warn('[sidebar-menu-order] paused panel re-registration after repeated rebuilds; keeping the current order');
        }
        return false;
      }

      function registerShadows(ordered, byId) {
        if (!allowRebuild()) return;
        debugLog('rebuild', ordered.length, 'entries');
        disposeShadows();
        const disposers = [];
        for (let index = 0; index < ordered.length; index += 1) {
          const id = ordered[index];
          const entry = byId.get(id);
          if (entry === undefined) continue;
          const options = {
            name: SLOT,
            id,
            order: (index + 1) * ORDER_STEP,
            priority: SHADOW_PRIORITY,
          };
          if (entry.options.label !== undefined) options.label = entry.options.label;
          if (entry.options.locale !== undefined) options.locale = entry.options.locale;
          if (entry.options.inject !== undefined) options.inject = entry.options.inject;
          try {
            disposers.push(ctx.slots.register(options, entry.component));
          } catch (error) {
            // A conflicting priority on the same id keeps the original row in place.
            console.error('[sidebar-menu-order] shadowing the panel "' + id + '" failed', error);
          }
        }
        shadowDisposers = disposers;
        appliedIds = ordered.slice();
        appliedEntries = ordered.map(id => byId.get(id));
      }

      let syncing = false;
      function sync() {
        if (disposing || syncing) return;
        syncing = true;
        try {
          const { byId, ordered } = collect();
          const panels = ordered.map(id => ({ id, label: labelOf(byId.get(id), id) }));
          const wantShadow = savedOrder.length > 0 && ordered.length > 0;
          if (!wantShadow) {
            if (shadowDisposers.length > 0) disposeShadows();
          } else {
            const unchanged = sameIds(ordered, appliedIds)
              && ordered.every((id, index) => appliedEntries[index] === byId.get(id))
              && shadowDisposers.length === ordered.length;
            if (!unchanged) registerShadows(ordered, byId);
          }
          debugLog('sync', ordered.length, 'panels, shadow=', wantShadow);
          if (!samePanels(snapshot.panels, panels)) publish({ panels });
        } finally {
          syncing = false;
        }
      }

      function requestSync() {
        if (queued || disposing) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          sync();
        });
      }

      /**
       * Apply a new order. Only the browser cache is written here: the profile
       * write happens once when the dialog closes, so one editing session costs
       * one settings write (and one Host config reload) instead of one per drop.
       * The slot rebuild is deferred out of the pointer/drag call stack as well.
       */
      function setOrder(ids) {
        savedOrder = ids.slice();
        dirty = true;
        writeLocalOrder(savedOrder);
        requestSync();
      }

      function reset() {
        savedOrder = [];
        dirty = true;
        writeLocalOrder(savedOrder);
        sync();
        void persistNow();
      }

      function open() {
        rebuildWindowStart = 0;
        rebuildsInWindow = 0;
        rebuildPaused = false;
        sync();
        publish({ open: true });
      }

      /** Close the dialog; a pending or failed save keeps it open so the outcome stays visible. */
      async function close() {
        if (saveTimer !== undefined) {
          clearTimeout(saveTimer);
          saveTimer = undefined;
        }
        if (dirty) {
          if (!hasWritableForm()) {
            dirty = false;
            publish({ status: 'localOnly', detail: '' });
          } else if (snapshot.status !== 'failed') {
            await flush();
            if (dirty) return;
          } else {
            // The failure was already shown; a second close leaves it and keeps the local order.
            dirty = false;
          }
        }
        publish({ open: false });
      }

      function formSnapshot(candidate) {
        try {
          return candidate.form.getSnapshot();
        } catch (error) {
          console.warn('[sidebar-menu-order] reading a settings snapshot failed', error);
          return undefined;
        }
      }

      /** Whether any probed namespace is served and accepts writes. */
      function hasWritableForm() {
        return formCandidates.some((candidate) => {
          const current = formSnapshot(candidate);
          return current !== undefined && current.status === 'ready' && current.writable === true;
        });
      }



      function persistNow() {
        writeLocalOrder(savedOrder);
        if (!hasWritableForm()) {
          activeForm = null;
          publish({ status: 'localOnly', detail: '' });
          return Promise.resolve();
        }
        return flush();
      }

      /** Reject a Host call that never settles, so a stuck write cannot pin the dialog. */
      function withTimeout(promise, ms) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { reject(new Error('the Host did not answer within ' + ms + 'ms')) }, ms);
          promise.then(
            (value) => { clearTimeout(timer); resolve(value) },
            (error) => { clearTimeout(timer); reject(error) },
          );
        });
      }

      /** Write the current order through every served namespace, stopping at the first acceptance. */
      async function flush() {
        const targets = formCandidates.filter((candidate) => {
          const current = formSnapshot(candidate);
          return current !== undefined && current.status === 'ready' && current.writable === true;
        });
        if (targets.length === 0) {
          activeForm = null;
          publish({ status: 'localOnly', detail: '' });
          return;
        }
        debugLog('write start', savedOrder.length, 'entries');
        publish({ status: 'saving', detail: '' });
        let failure;
        for (const candidate of targets) {
          try {
            const accepted = await withTimeout(candidate.form.set('order', savedOrder.slice()), 10000);
            if (accepted) {
              activeForm = candidate;
              dirty = false;
              debugLog('write done');
              publish({ status: 'saved', detail: '', storage: 'profile' });
              return;
            }
          } catch (error) {
            console.error('[sidebar-menu-order] saving the order failed', error);
            failure = error;
          }
        }
        activeForm = null;
        publish({ status: 'failed', detail: failure === undefined ? t('dialog.refused') : errorMessage(failure) });
      }

      /**
       * Adopt the profile's stored order. The local cache is a fallback only: it is
       * never written back on startup, so another profile's cache (or a reset that
       * stored an empty order) cannot resurrect an old order on reload.
       */
      function attachFormsFrom(scope) {
        detachForms();
        detachForms = () => {};
        let service;
        try {
          service = scope.get('configForms');
        } catch (error) {
          console.warn('[sidebar-menu-order] configForms is unavailable', error);
          return;
        }
        if (service === undefined || service === null || typeof service.get !== 'function') return;
        let served = false;
        for (const id of ENTRY_IDS) {
          let candidateForm;
          try {
            candidateForm = service.get(id);
          } catch (error) {
            console.warn('[sidebar-menu-order] reading the settings form failed for ' + id, error);
            continue;
          }
          if (candidateForm === undefined || candidateForm === null) continue;
          const candidate = { id, form: candidateForm, off: () => {} };
          const adopt = () => {
            const current = formSnapshot(candidate);
            if (current === undefined || current.status !== 'ready') return;
            served = true;
            if (current.writable === true) {
              if (activeForm === null) activeForm = candidate;
              if (snapshot.storage !== 'profile') publish({ storage: 'profile' });
            } else if (snapshot.storage === 'unknown') {
              publish({ storage: 'local' });
            }
            const hostOrder = readHostOrder(current.value);
            if (hostOrder.length > 0 && !sameIds(hostOrder, savedOrder)) {
              savedOrder = hostOrder;
              writeLocalOrder(savedOrder);
              requestSync();
            }
          };
          try {
            candidate.off = candidateForm.subscribe(adopt);
          } catch (error) {
            console.warn('[sidebar-menu-order] subscribing to the settings form failed for ' + id, error);
          }
          formCandidates.push(candidate);
          adopt();
        }
        if (!served && snapshot.storage === 'unknown') publish({ storage: 'local' });
        detachForms = () => {
          for (const candidate of formCandidates) {
            try {
              candidate.off();
            } catch (error) {
              console.warn('[sidebar-menu-order] unsubscribing from the settings form failed', error);
            }
          }
          formCandidates.length = 0;
        };
      }

      let detachForms = () => {};

      function dispose() {
        if (disposing) return;
        disposing = true;
        if (saveTimer !== undefined) clearTimeout(saveTimer);
        saveTimer = undefined;
        detachForms();
        disposeShadows();
        listeners.clear();
      }

      return {
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot: () => snapshot,
        requestSync,
        open,
        close,
        setOrder,
        reset,
        attachFormsFrom,
        detachForms: () => {
          detachForms();
          detachForms = () => {};
        },
        dispose,
      };
    }

    /* ---------------------------------------------------------------- *
     * Styles and icons
     * ---------------------------------------------------------------- */

    const scrimStyle = {
      position: 'fixed',
      inset: 0,
      top: 'var(--dsh-frame-chrome-top, 0px)',
      zIndex: 2147483000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      paddingTop: 'max(24px, var(--dsh-frame-overlay-top, 24px))',
      background: 'var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.32))',
      backdropFilter: 'blur(var(--dsw-mask-blur, 0px))',
      overscrollBehavior: 'contain',
      pointerEvents: 'auto',
    };

    const dialogStyle = {
      width: 'min(420px, 100%)',
      maxHeight: 'min(560px, 86vh)',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
      padding: '24px',
      gap: '20px',
      borderRadius: 'var(--dsw-radius-panel, 28px)',
      background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
      color: 'var(--dsw-alias-label-primary, #1f2328)',
      boxShadow: 'var(--dsw-elevation-prominent, 0 18px 48px rgba(0, 0, 0, 0.28))',
      outline: 'none',
    };

    const titleStyle = {
      margin: 0,
      fontSize: '16px',
      fontWeight: 500,
      lineHeight: '24px',
    };

    const hintStyle = {
      margin: 0,
      fontSize: '12px',
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-tertiary, rgba(84, 90, 98, 0.75))',
    };

    const listStyle = {
      margin: 0,
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      overflowY: 'auto',
      overscrollBehavior: 'contain',
    };

    const rowItemStyle = {
      listStyle: 'none',
      position: 'relative',
    };

    const rowStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      height: '36px',
      padding: '0 4px 0 8px',
      borderRadius: 'var(--dsw-radius-sm, 8px)',
      background: 'transparent',
      cursor: 'grab',
      userSelect: 'none',
    };

    const rowHoverStyle = {
      background: 'var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12))',
    };

    const gripStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--dsw-alias-label-tertiary, rgba(84, 90, 98, 0.75))',
      flex: '0 0 auto',
    };

    const nameStyle = {
      flex: '1 1 auto',
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontSize: '13px',
      lineHeight: '20px',
    };

    const dropLineStyle = {
      position: 'absolute',
      left: 4,
      right: 4,
      height: '2px',
      borderRadius: '1px',
      background: 'var(--dsw-alias-state-business-primary, #1f6feb)',
      pointerEvents: 'none',
      zIndex: 1,
    };

    const moveButtonStyle = {
      flex: '0 0 auto',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '28px',
      height: '28px',
      padding: 0,
      border: 'none',
      borderRadius: 'var(--dsw-radius-sm, 8px)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary, rgba(31, 35, 40, 0.78))',
      cursor: 'pointer',
    };

    const footerStyle = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
    };

    const statusStyle = {
      fontSize: '12px',
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-tertiary, rgba(84, 90, 98, 0.75))',
      flex: '1 1 auto',
      minWidth: 0,
      whiteSpace: 'normal',
      overflowWrap: 'anywhere',
    };

    const secondaryButtonStyle = {
      flex: '0 0 auto',
      height: '32px',
      padding: '0 12px',
      border: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24))',
      borderRadius: 'var(--dsw-radius-sm, 8px)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary, rgba(31, 35, 40, 0.78))',
      fontSize: '13px',
      cursor: 'pointer',
    };

    const primaryButtonStyle = {
      flex: '0 0 auto',
      height: '32px',
      padding: '0 14px',
      border: 'none',
      borderRadius: 'var(--dsw-radius-sm, 8px)',
      background: 'var(--dsw-alias-brand-primary, #1f6feb)',
      color: 'var(--dsw-alias-label-primary-inverted, #ffffff)',
      fontSize: '13px',
      fontWeight: 500,
      cursor: 'pointer',
    };

    const menuRowStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      width: '100%',
      minHeight: '34px',
      padding: '6px 8px',
      border: 'none',
      borderRadius: 'var(--dsw-radius-md, 12px)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary, #1f2328)',
      font: 'inherit',
      fontSize: '13px',
      lineHeight: '20px',
      textAlign: 'left',
      cursor: 'pointer',
    };

    const menuSeparatorStyle = {
      height: '0.5px',
      margin: '3px 8px',
      background: 'var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24))',
    };

    /** Hover and focus rules for dialog controls; scoped to the dialog's own class. */
    const DIALOG_STYLES = `
.dsmo-dialog button:not([disabled]):hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12)); }
.dsmo-dialog button:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, #1f6feb); outline-offset: 1px; }
.dsmo-dialog .dsmo-row:focus-within { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12)); }
`;

    function GripIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false',
      },
      h('circle', { cx: 6, cy: 4, r: 1.3 }), h('circle', { cx: 10, cy: 4, r: 1.3 }),
      h('circle', { cx: 6, cy: 8, r: 1.3 }), h('circle', { cx: 10, cy: 8, r: 1.3 }),
      h('circle', { cx: 6, cy: 12, r: 1.3 }), h('circle', { cx: 10, cy: 12, r: 1.3 }));
    }

    function ChevronIcon({ direction, size }) {
      const d = direction === 'up' ? 'M4 10 L8 6 L12 10' : 'M4 6 L8 10 L12 6';
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false',
      }, h('path', { d }));
    }

    function CloseIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': 'true', focusable: 'false',
      }, h('path', { d: 'M4 4 L12 12' }), h('path', { d: 'M12 4 L4 12' }));
    }

    /* ---------------------------------------------------------------- *
     * Slot components
     * ---------------------------------------------------------------- */

    function MenuOrderAction({ onDismiss, controller, closeDrawer, t }) {
      const [hover, setHover] = useState(false);
      return h(React.Fragment, null,
        h('div', { key: 'separator', style: menuSeparatorStyle, 'aria-hidden': 'true' }),
        h('button', {
          key: 'action',
          type: 'button',
          role: 'menuitem',
          style: hover ? { ...menuRowStyle, background: 'var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12))' } : menuRowStyle,
          onPointerEnter: () => setHover(true),
          onPointerLeave: () => setHover(false),
          onFocus: () => setHover(true),
          onBlur: () => setHover(false),
          onClick: () => {
            onDismiss();
            // The narrow layout renders the sidebar as a modal drawer above the
            // frame overlay; closing it first lets the dialog receive the pointer.
            closeDrawer();
            controller.open();
          },
        },
        h('span', { style: gripStyle, 'aria-hidden': 'true' }, h(GripIcon, { size: 16 })),
        h('span', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t('menu.action'))));
    }

    function OrderDialog({ controller, t }) {
      const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
      const [dragId, setDragId] = useState(null);
      const [drop, setDrop] = useState(null);
      const [hoverId, setHoverId] = useState(null);
      const dialogRef = useRef(null);
      const open = snapshot.open;

      useEffect(() => {
        if (!open) return undefined;
        const previous = document.activeElement;
        const node = dialogRef.current;
        if (node !== null) node.focus();
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            controller.close();
            return;
          }
          if (event.key === 'Tab' && node !== null) trapFocus(event, node);
        };
        window.document.addEventListener('keydown', onKeyDown, true);
        return () => {
          window.document.removeEventListener('keydown', onKeyDown, true);
          if (previous !== null && previous !== window.document.body && typeof previous.focus === 'function' && previous.isConnected === true) {
            previous.focus();
          }
        };
      }, [open, controller]);

      if (!open) return null;

      const ids = snapshot.panels.map(panel => panel.id);
      const storageHint = snapshot.storage === 'profile'
        ? t('dialog.modeProfile')
        : snapshot.storage === 'local'
          ? t('dialog.modeLocal')
          : '';
      const finished = snapshot.status === 'failed'
        ? t('dialog.failed', { reason: snapshot.detail.length > 0 ? snapshot.detail : t('dialog.failedGeneric') })
        : snapshot.status === 'saved'
          ? t('dialog.saved')
          : snapshot.status === 'saving'
            ? t('dialog.saving')
            : snapshot.status === 'localOnly'
              ? t('dialog.localOnly')
              : storageHint;

      const rows = snapshot.panels.map((panel, index) => {
        const last = index === snapshot.panels.length - 1;
        const marker = drop !== null && drop.id === panel.id ? drop.half : null;
        const dragging = dragId === panel.id;
        const style = {
          ...rowStyle,
          ...(hoverId === panel.id && !dragging ? rowHoverStyle : {}),
          ...(dragging ? { opacity: 0.45 } : {}),
        };
        return h('li', {
          key: panel.id,
          style: rowItemStyle,
          'aria-posinset': index + 1,
          'aria-setsize': snapshot.panels.length,
        },
          marker === 'before' ? h('div', { style: { ...dropLineStyle, top: '-1px' }, 'aria-hidden': 'true' }) : null,
          h('div', {
            className: 'dsmo-row',
            draggable: true,
            style,
            onPointerEnter: () => setHoverId(panel.id),
            onPointerLeave: () => setHoverId(current => (current === panel.id ? null : current)),
            onDragStart: (event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', panel.id);
              setDragId(panel.id);
              setDrop(null);
            },
            onDragOver: (event) => {
              if (dragId === null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              const rect = event.currentTarget.getBoundingClientRect();
              const half = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
              setDrop(current => (current !== null && current.id === panel.id && current.half === half ? current : { id: panel.id, half }));
            },
            onDrop: (event) => {
              if (dragId === null) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              const half = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
              const source = dragId;
              setDragId(null);
              setDrop(null);
              const next = reorderByDrop(ids, source, panel.id, half === 'after');
              if (next !== undefined) controller.setOrder(next);
            },
            onDragEnd: () => {
              setDragId(null);
              setDrop(null);
            },
          },
          h('span', { style: gripStyle, 'aria-hidden': 'true' }, h(GripIcon, { size: 14 })),
          h('span', { style: nameStyle, title: panel.label }, panel.label),
          h('button', {
            type: 'button',
            style: { ...moveButtonStyle, opacity: index === 0 ? 0.35 : 1, cursor: index === 0 ? 'default' : 'pointer' },
            disabled: index === 0,
            'aria-label': t('dialog.moveUp', { name: panel.label }),
            onClick: () => {
              const next = moveBy(ids, index, -1);
              if (next !== undefined) controller.setOrder(next);
            },
          }, h(ChevronIcon, { direction: 'up', size: 14 })),
          h('button', {
            type: 'button',
            style: { ...moveButtonStyle, opacity: last ? 0.35 : 1, cursor: last ? 'default' : 'pointer' },
            disabled: last,
            'aria-label': t('dialog.moveDown', { name: panel.label }),
            onClick: () => {
              const next = moveBy(ids, index, 1);
              if (next !== undefined) controller.setOrder(next);
            },
          }, h(ChevronIcon, { direction: 'down', size: 14 }))),
          marker === 'after' ? h('div', { style: { ...dropLineStyle, bottom: '-1px' }, 'aria-hidden': 'true' }) : null);
      });

      return h('div', {
        className: 'dsmo-scrim',
        style: scrimStyle,
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) controller.close();
        },
        onWheel: (event) => { event.stopPropagation(); },
        onTouchMove: (event) => { event.stopPropagation(); },
      }, h('div', {
        ref: dialogRef,
        className: 'dsmo-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': TITLE_ID,
        'aria-describedby': HINT_ID,
        tabIndex: -1,
        style: dialogStyle,
      },
      h('style', { key: 'styles' }, DIALOG_STYLES),
      h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '8px' } },
        h('div', { style: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' } },
          h('h2', { id: TITLE_ID, style: titleStyle }, t('dialog.title')),
          h('p', { id: HINT_ID, style: hintStyle }, t('dialog.hint'))),
        h('button', {
          type: 'button',
          style: { ...moveButtonStyle, width: '28px', height: '28px' },
          'aria-label': t('dialog.close'),
          onClick: () => controller.close(),
        }, h(CloseIcon, { size: 16 }))),
      snapshot.panels.length === 0
        ? h('p', { style: hintStyle }, t('dialog.empty'))
        : h('ul', { style: listStyle }, rows),
      h('div', { style: footerStyle },
        h('span', {
          style: snapshot.status === 'failed'
            ? { ...statusStyle, color: 'var(--dsw-alias-state-error-primary, #d92d20)' }
            : statusStyle,
          role: 'status',
          'aria-live': 'polite',
        }, finished),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto' } },
          h('button', { type: 'button', style: secondaryButtonStyle, onClick: () => controller.reset() }, t('dialog.reset')),
          h('button', { type: 'button', style: primaryButtonStyle, onClick: () => controller.close() }, t('dialog.done'))))));
    }

    /* ---------------------------------------------------------------- *
     * Plugin body
     * ---------------------------------------------------------------- */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'sidebar-menu-order: dictionaries');
        const t = ctx.locale.bind(NS);
        const controller = createController(ctx, t);

        ctx.effect(() => () => controller.dispose(), 'sidebar-menu-order: controller');

        // The narrow layout renders the sidebar as a modal drawer above the
        // frame's overlay layer, so the More action closes it before opening
        // the dialog. Wide layouts (and the Windows titlebar shell) keep it.
        const closeDrawer = () => {
          if (window.innerWidth >= 768) return;
          if (window.document.documentElement.hasAttribute('data-windows-titlebar')) return;
          try {
            ctx.get('layout')?.toggleSidebar();
          } catch (error) {
            console.warn('[sidebar-menu-order] closing the sidebar drawer failed', error);
          }
        };

        ctx.slots.inject(SLOT, () => {
          const off = ctx.slots.subscribe(SLOT, () => controller.requestSync());
          controller.requestSync();
          return () => {
            off();
            controller.requestSync();
          };
        });

        // Follow the settings service rather than reading it once at apply time:
        // the form attach re-runs when the service (re)activates, and its effect
        // detaches the subscriptions when the service goes away.
        ctx.inject(['configForms'], (scope) => {
          controller.attachFormsFrom(scope);
          scope.effect(() => () => controller.detachForms(), 'sidebar-menu-order: settings forms');
        });

        ctx.slots.inject(ACTIONS_SLOT, () => ctx.slots.register({
          name: ACTIONS_SLOT,
          id: 'sidebar-menu-order',
          order: 1,
          locale: NS,
          inject: () => ({ controller, closeDrawer }),
        }, MenuOrderAction));

        ctx.slots.inject(OVERLAY_SLOT, () => ctx.slots.register({
          name: OVERLAY_SLOT,
          id: 'sidebar-menu-order-dialog',
          locale: NS,
          inject: () => ({ controller }),
        }, OrderDialog));

        if (typeof ctx.locale.subscribe === 'function') {
          ctx.effect(() => ctx.locale.subscribe(() => controller.requestSync()), 'sidebar-menu-order: locale changes');
        }
      },
    };
  },
});
