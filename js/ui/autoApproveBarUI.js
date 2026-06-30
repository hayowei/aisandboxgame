// js/ui/autoApproveBarUI.js
// 右侧栏 tab-strip 下方的自动审批工具条（双胶囊 chip）
// 两个 chip 分别控制 NPC 字段更新 / 物品+货币变更的自动审批
// 偏好走 aiService.saveConfig（localStorage 'ai_adventure_settings'，跨存档）
//
// 视觉状态：
//   aria-pressed="false" → 描边胶囊 + toggle_off 图标（手动）
//   aria-pressed="true"  → brand-primary 填充 + toggle_on 图标（自动）

(function () {
  'use strict';

  const NPC_KEY = 'autoApproveNpc';
  const INV_KEY = 'autoApproveInventory';

  function getConfigValue(key) {
    return window.aiService?.config?.[key] === true;
  }

  function setChipState(chip, on) {
    if (!chip) return;
    chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    const icon = chip.querySelector('.auto-approve-chip-icon');
    if (icon) icon.textContent = on ? 'toggle_on' : 'toggle_off';
  }

  function init() {
    const npcChip = document.getElementById('auto-approve-npc-toggle');
    const invChip = document.getElementById('auto-approve-inventory-toggle');
    if (!npcChip || !invChip) {
      console.warn('[autoApproveBarUI] chip 节点未找到');
      return;
    }

    // 1) 初始化视觉状态 + 同步到 store
    const npcOn = getConfigValue(NPC_KEY);
    const invOn = getConfigValue(INV_KEY);
    setChipState(npcChip, npcOn);
    setChipState(invChip, invOn);
    window.npcStore?.setAutoApprove?.(npcOn);
    window.inventoryStore?.setAutoApprove?.(invOn);

    // 2) chip 点击切换
    npcChip.addEventListener('click', () => {
      const next = npcChip.getAttribute('aria-pressed') !== 'true';
      setChipState(npcChip, next);
      window.aiService?.saveConfig?.({ [NPC_KEY]: next });
      window.npcStore?.setAutoApprove?.(next);
    });
    invChip.addEventListener('click', () => {
      const next = invChip.getAttribute('aria-pressed') !== 'true';
      setChipState(invChip, next);
      window.aiService?.saveConfig?.({ [INV_KEY]: next });
      window.inventoryStore?.setAutoApprove?.(next);
    });

    // 3) 存档恢复后若处于自动模式，flush 还原出的 pending
    const bus = window.eventBus;
    const events = window.GameEvents;
    if (bus && events) {
      if (events.NPC_RESTORED) {
        bus.on(events.NPC_RESTORED, () => {
          if (getConfigValue(NPC_KEY)) window.npcStore?.setAutoApprove?.(true);
        });
      }
      if (events.INVENTORY_RESTORED) {
        bus.on(events.INVENTORY_RESTORED, () => {
          if (getConfigValue(INV_KEY)) window.inventoryStore?.setAutoApprove?.(true);
        });
      }
    }

    console.log('[autoApproveBarUI] Initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    queueMicrotask(init);
  }
})();
