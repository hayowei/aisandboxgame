// ============================================
// Phone UI - 手机界面 UI 模块
// ============================================

// 依赖: smsService (来自 smsService.js)

function _phoneIsEnglish() {
  return (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en';
}

function _phoneText(key, params = {}) {
  const zh = {
    home: '手机',
    sms: '短信',
    contacts: '通讯录',
    unavailable: '功能暂未开发完全，后续版本将更新',
    notOpen: '该功能暂未开放',
    noContacts: '暂无联系人',
    dynamicGroup: '临时角色',
    predefinedGroup: '预定义角色',
    dynamicBadge: '临时',
    age: '年龄',
    unknown: '未知',
    personality: '性格',
    appearance: '外貌',
    clothing: '衣着',
    cognition: '认知',
    relationshipLabel: '关系',
    locationLabel: '地点',
    cognitionLabel: '状态',
    sendSms: '发短信',
    noSms: '暂无短信记录<br><small>从通讯录发起对话</small>',
    youPrefix: '你: ',
    startChat: '开始对话...',
    deleteConversationTitle: '删除对话',
    deleteConversationText: `确定要删除与 ${params.name || '此联系人'} 的所有对话吗？`,
    conversationDeleted: '对话已删除',
    startConversation: '发送一条消息开始对话',
    synced: '已同步到主聊天',
    pendingSync: '待同步到主聊天',
    copy: '复制',
    regenerate: '重新生成',
    delete: '删除',
    edit: '编辑',
    copied: '已复制到剪贴板',
    copyFailed: '复制失败',
    close: '关闭',
    noUserMessage: '找不到对应的用户消息',
    regenerated: '已重新生成',
    regenerateFailed: `重新生成失败: ${params.error || ''}`,
    messageDeleted: '消息已删除',
    saved: '已保存修改',
    save: '保存',
    cancel: '取消',
    sendFailed: `发送失败: ${params.error || ''}`,
    gameTimeUnknown: '游戏时间未知',
  };
  const en = {
    home: 'Phone',
    sms: 'Messages',
    contacts: 'Contacts',
    unavailable: 'This feature is not finished yet. A later version will improve it.',
    notOpen: 'This feature is not available yet.',
    noContacts: 'No contacts yet',
    dynamicGroup: 'Dynamic Characters',
    predefinedGroup: 'Predefined Characters',
    dynamicBadge: 'Dynamic',
    age: 'Age',
    unknown: 'Unknown',
    personality: 'Personality',
    appearance: 'Appearance',
    clothing: 'Clothing',
    cognition: 'Cognition',
    relationshipLabel: 'Relationship',
    locationLabel: 'Location',
    cognitionLabel: 'State',
    sendSms: 'Message',
    noSms: 'No message history yet<br><small>Start a chat from Contacts</small>',
    youPrefix: 'You: ',
    startChat: 'Start the conversation...',
    deleteConversationTitle: 'Delete conversation',
    deleteConversationText: `Delete the full conversation with ${params.name || 'this contact'}?`,
    conversationDeleted: 'Conversation deleted',
    startConversation: 'Send a message to start the conversation',
    synced: 'Synced to main chat',
    pendingSync: 'Waiting to sync to main chat',
    copy: 'Copy',
    regenerate: 'Regenerate',
    delete: 'Delete',
    edit: 'Edit',
    copied: 'Copied to clipboard',
    copyFailed: 'Copy failed',
    close: 'Close',
    noUserMessage: 'Could not find the related user message',
    regenerated: 'Regenerated',
    regenerateFailed: `Regenerate failed: ${params.error || ''}`,
    messageDeleted: 'Message deleted',
    saved: 'Saved',
    save: 'Save',
    cancel: 'Cancel',
    sendFailed: `Send failed: ${params.error || ''}`,
    gameTimeUnknown: 'Game time unavailable',
  };
  const dict = _phoneIsEnglish() ? en : zh;
  return dict[key] || key;
}

// 手机应用配置
const PHONE_APPS = {
  contacts: { id: 'contacts', symbol: 'person_book', cssClass: 'contacts' },
  sms:      { id: 'sms',      symbol: 'chat_bubble',  cssClass: 'sms' },
  groups:   { id: 'groups',    symbol: 'group',        cssClass: 'groups' },
  moments:  { id: 'moments',   symbol: 'auto_awesome', cssClass: 'moments' },
};

// 所有可切换的视图 ID（用于统一隐藏）
const PHONE_ALL_VIEWS = [
  'phone-home-screen',
  'phone-contact-list',
  'phone-chat-view',
  'phone-contacts-app',
  'phone-contact-detail',
  'phone-groups-view',
  'phone-moments-view',
  'phone-news-view',
];

class PhoneUI {
  constructor() {
    this.modal = document.getElementById('phone-modal');
    this.currentApp = null; // 当前打开的应用
    this.currentContact = null;
    this.isLoading = false;
    this.pendingDeleteIndex = null; // 待删除的消息索引
    this.pendingDeleteContactId = null; // 待删除对话的联系人ID

    this.init();
  }

  init() {
    // 绑定关闭按键
    const closeBtn = document.getElementById('close-phone-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }

    // 绑定返回按键
    const backBtn = document.getElementById('phone-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.handleBack());
    }

    // 绑定发送按键
    const sendBtn = document.getElementById('sms-send-btn');
    if (sendBtn) {
      sendBtn.addEventListener('click', () => this.sendMessage());
    }

    // 绑定输入框回车发送
    const input = document.getElementById('sms-input');
    if (input) {
      input.addEventListener('keypress', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });
    }

    // 点击背景关闭
    if (this.modal) {
      this.modal.addEventListener('click', e => {
        if (e.target === this.modal) {
          this.close();
        }
      });
    }

    // 绑定删除确认弹窗按键
    const confirmDeleteBtn = document.getElementById('sms-delete-confirm-btn');
    if (confirmDeleteBtn) {
      confirmDeleteBtn.addEventListener('click', () => this.confirmDeleteMessage());
    }
    const cancelDeleteBtn = document.getElementById('sms-delete-cancel-btn');
    if (cancelDeleteBtn) {
      cancelDeleteBtn.addEventListener('click', () => this.cancelDeleteMessage());
    }

    // 绑定删除对话确认弹窗按键
    const confirmDeleteConvBtn = document.getElementById('sms-delete-conv-confirm-btn');
    if (confirmDeleteConvBtn) {
      confirmDeleteConvBtn.addEventListener('click', () => this.confirmDeleteConversation());
    }
    const cancelDeleteConvBtn = document.getElementById('sms-delete-conv-cancel-btn');
    if (cancelDeleteConvBtn) {
      cancelDeleteConvBtn.addEventListener('click', () => this.cancelDeleteConversation());
    }

    // 绑定底部导航 tab（仅 phone-bottom-nav 内）
    document.querySelectorAll('.phone-bottom-nav .tab[data-phone-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabId = tab.dataset.phoneTab;
        if (tabId) this.switchTab(tabId);
      });
    });

    // 绑定 debug 按键
    const debugBtn = document.getElementById('sms-debug-btn');
    if (debugBtn) {
      debugBtn.addEventListener('click', () => {
        if (typeof window.openDebugModal === 'function') {
          window.openDebugModal('sms');
        }
      });
    }

    this.syncHeaderChrome();
  }

  // 隐藏所有 phone 视图
  hideAllViews() {
    PHONE_ALL_VIEWS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
  }

  // 更新底部导航激活状态
  syncNavActive(tabId) {
    document.querySelectorAll('.phone-bottom-nav .tab[data-phone-tab]').forEach(tab => {
      tab.classList.toggle('is-active', tab.dataset.phoneTab === tabId);
    });
  }

  // 切换底部导航 tab
  switchTab(tabId) {
    switch (tabId) {
      case 'contacts':
        this.currentApp = 'contacts';
        this.showContactsApp();
        break;
      case 'sms':
        this.currentApp = 'sms';
        this.showContactList();
        break;
      case 'groups':
        this.currentApp = 'groups';
        this.currentContact = null;
        this.hideAllViews();
        document.getElementById('phone-groups-view').classList.remove('hidden');
        document.getElementById('phone-back-btn').classList.add('hidden');
        document.getElementById('phone-title').textContent = _phoneIsEnglish() ? 'Groups' : '群聊';
        this.hideSubtitle();
        this.syncNavActive('groups');
        break;
      case 'moments':
        this.currentApp = 'moments';
        this.currentContact = null;
        this.hideAllViews();
        document.getElementById('phone-moments-view').classList.remove('hidden');
        document.getElementById('phone-back-btn').classList.add('hidden');
        document.getElementById('phone-title').textContent = _phoneIsEnglish() ? 'Moments' : '动态';
        this.hideSubtitle();
        this.syncNavActive('moments');
        break;
      case 'news':
        this.currentApp = 'news';
        this.currentContact = null;
        this.hideAllViews();
        document.getElementById('phone-news-view').classList.remove('hidden');
        document.getElementById('phone-back-btn').classList.add('hidden');
        document.getElementById('phone-title').textContent = _phoneIsEnglish() ? 'News' : '新闻';
        this.hideSubtitle();
        this.syncNavActive('news');
        break;
      default:
        this.showHomeScreen();
        break;
    }
  }

  syncHeaderChrome() {
    const closeBtn = document.getElementById('close-phone-btn');
    if (closeBtn) {
      const closeText = _phoneText('close');
      closeBtn.textContent = closeText;
      closeBtn.setAttribute('aria-label', closeText);
      closeBtn.title = closeText;
    }
  }

  open() {
    if (this.modal) {
      this.modal.classList.remove('hidden');
      this.syncHeaderChrome();
      this.showHomeScreen();
    }
  }

  close() {
    if (this.modal) {
      this.modal.classList.add('hidden');
      this.currentApp = null;
      this.currentContact = null;
    }
  }

  // 处理返回按键
  handleBack() {
    if (this.currentContact && this.currentApp === 'sms') {
      // 从短信聊天界面返回短信列表
      this.showContactList();
    } else if (this.currentContact && this.currentApp === 'contacts') {
      // 从联系人详情返回通讯录列表
      this.showContactsApp();
    } else {
      // 默认返回主屏幕
      this.showHomeScreen();
    }
  }

  // 显示主屏幕
  showHomeScreen() {
    this.currentApp = null;
    this.currentContact = null;

    this.hideAllViews();
    document.getElementById('phone-home-screen').classList.remove('hidden');

    // 更新 header
    this.syncHeaderChrome();
    document.getElementById('phone-back-btn').classList.add('hidden');
    document.getElementById('phone-title').textContent = 'Doodle Diary';
    this.hideSubtitle();

    // 清除底部导航激活态
    this.syncNavActive(null);

    // 渲染主屏
    this.renderHomeScreen();
  }

  // 渲染主屏幕 (Stitch Doodle Diary 风格)
  renderHomeScreen() {
    const container = document.getElementById('phone-home-content');
    if (!container) return;

    const isEn = _phoneIsEnglish();
    const quoteText = isEn
      ? '"Every scribble tells a story..."'
      : '"每一笔涂鸦，都诉说着我们的故事..."';
    const newsLabel = isEn ? 'Latest Entry' : '最新动态';
    const newsTitle = isEn ? 'The world is writing...' : '世界正在书写...';

    container.innerHTML = `
      <div class="phone-home-quote">
        <div class="phone-home-quote-date"></div>
        <div class="phone-home-quote-box">
          <div class="phone-home-quote-text">${quoteText}</div>
        </div>
      </div>
      <div class="phone-home-grid">
        <div class="phone-home-app" data-app-id="contacts">
          <div class="phone-home-app-icon phone-home-app-icon--contacts phone-wobbly">
            <span class="material-symbols-outlined">person_book</span>
          </div>
          <span class="phone-home-app-name">${_phoneText('contacts')}</span>
        </div>
        <div class="phone-home-app" data-app-id="sms">
          <div class="phone-home-app-icon phone-home-app-icon--sms phone-wobbly-alt">
            <span class="material-symbols-outlined">chat_bubble</span>
            <span id="sms-app-badge" class="phone-home-badge hidden"></span>
          </div>
          <span class="phone-home-app-name">${_phoneText('sms')}</span>
        </div>
        <div class="phone-home-app" data-app-id="groups">
          <div class="phone-home-app-icon phone-home-app-icon--groups phone-wobbly-alt">
            <span class="material-symbols-outlined">group</span>
          </div>
          <span class="phone-home-app-name">${isEn ? 'Groups' : '群聊'}</span>
        </div>
        <div class="phone-home-app" data-app-id="moments">
          <div class="phone-home-app-icon phone-home-app-icon--moments phone-wobbly">
            <span class="material-symbols-outlined">auto_awesome</span>
          </div>
          <span class="phone-home-app-name">${isEn ? 'Moments' : '动态'}</span>
        </div>
      </div>
      <div class="phone-home-news-bar" data-app-id="news">
        <span class="material-symbols-outlined">newspaper</span>
        <div class="phone-home-news-info">
          <div class="phone-home-news-label">${newsLabel}</div>
          <div class="phone-home-news-title">${newsTitle}</div>
        </div>
      </div>
    `;

    // 填充日期
    const dateEl = container.querySelector('.phone-home-quote-date');
    if (dateEl) {
      const gt = this._getCurrentGameTime();
      dateEl.textContent = gt ? `${gt.year}.${gt.month}.${gt.day}` : '';
    }

    // 绑定点击事件
    container.querySelectorAll('[data-app-id]').forEach(el => {
      el.addEventListener('click', () => {
        this.switchTab(el.dataset.appId);
      });
    });

    // 更新红点显示
    if (typeof smsService !== 'undefined') {
      smsService.updateBadge();
    }
  }

  // 打开应用（委托给 switchTab）
  openApp(appId) {
    this.switchTab(appId);
  }

  // ========================================
  // 通讯录应用
  // ========================================

  // 显示通讯录应用
  showContactsApp() {
    this.currentContact = null;

    this.hideAllViews();
    document.getElementById('phone-contacts-app').classList.remove('hidden');

    // 更新 header
    this.syncHeaderChrome();
    document.getElementById('phone-back-btn').classList.add('hidden');
    document.getElementById('phone-title').textContent = _phoneText('contacts');
    this.hideSubtitle();
    this.syncNavActive('contacts');

    // 渲染联系人列表
    this.renderContactsApp();
  }

  // 渲染通讯录列表
  renderContactsApp() {
    const container = document.getElementById('contacts-app-list');
    if (!container) return;

    // 获取所有联系人(系统 + 临时)
    const allContacts = getAllContacts();

    if (allContacts.length === 0) {
      container.innerHTML = `<div class="contacts-empty">${_phoneText('noContacts')}</div>`;
      return;
    }

    // 分组
    const systemContacts = allContacts.filter(c => c.type === 'system' || !c.type);
    const dynamicContacts = allContacts.filter(c => c.type === 'dynamic');

    let html = '';

    // 临时角色组(优先显示)
    if (dynamicContacts.length > 0) {
      html += `<div class="contact-group-header"><span class="material-symbols-outlined">auto_awesome</span> ${_phoneText('dynamicGroup')}</div>`;
      html += dynamicContacts.map(contact => this.renderContactsAppItem(contact, true)).join('');
    }

    // 预定义角色组
    if (systemContacts.length > 0) {
      html += `<div class="contact-group-header"><span class="material-symbols-outlined">favorite</span> ${_phoneText('predefinedGroup')}</div>`;
      html += systemContacts.map(contact => this.renderContactsAppItem(contact)).join('');
    }

    container.innerHTML = html;

    // 绑定点击事件
    container.querySelectorAll('.contacts-app-item').forEach(item => {
      item.addEventListener('click', () => {
        this.showContactDetail(item.dataset.contactId);
      });
    });
  }

  // 渲染单个通讯录联系人项
  renderContactsAppItem(contact, isDynamic = false) {
    const dynamicClass = isDynamic ? ' contacts-dynamic' : '';
    const avatarToneClass = isDynamic ? ' contacts-avatar--dynamic' : ' contacts-avatar--default';

    return `
            <div class="contacts-app-item${dynamicClass}" data-contact-id="${contact.id}">
                <div class="contacts-avatar${avatarToneClass}">
                    ${(contact.name || '?').charAt(0)}
                </div>
                <div class="contacts-info">
                    <div class="contacts-name">${this.escapeHtml(contact.name)}</div>
                    <div class="contacts-personality">${this.escapeHtml(contact.personality)}</div>
                </div>
                <span class="material-symbols-outlined contacts-arrow">chevron_right</span>
            </div>
        `;
  }

  // 显示联系人详情
  showContactDetail(contactId) {
    // 使用统一接口获取联系人信息
    const contact = getContactInfo(contactId);
    if (!contact) return;

    const isDynamic = contact.type === 'dynamic';
    this.currentContact = contactId;

    // 切换视图
    this.hideAllViews();
    document.getElementById('phone-contact-detail').classList.remove('hidden');
    this.syncHeaderChrome();
    document.getElementById('phone-back-btn').classList.remove('hidden');
    document.getElementById('phone-title').textContent = contact.name;

    // 渲染详情
    const detailContainer = document.getElementById('contact-detail-content');
    if (detailContainer) {
      const headerClass = isDynamic ? ' dynamic-header' : '';
      const avatarToneClass = isDynamic
        ? ' contact-detail-avatar--dynamic'
        : ' contact-detail-avatar--default';
      const typeBadge = isDynamic
        ? `<span class="contact-type-badge">${_phoneText('dynamicBadge')}</span>`
        : '';

      // 根据角色类型渲染不同的详情字段
      let detailFields = '';
      if (isDynamic) {
        // 临时角色:显示外貌、衣着、认知状态
        detailFields = `
                <div class="contact-detail-row">
                    <span class="detail-label">${_phoneText('age')}</span>
                    <span class="detail-value">${contact.age || _phoneText('unknown')}</span>
                </div>
                <div class="contact-detail-row">
                    <span class="detail-label">${_phoneText('personality')}</span>
                    <span class="detail-value">${this.escapeHtml(contact.personality || _phoneText('unknown'))}</span>
                </div>
                ${
                  contact.appearance
                    ? `<div class="contact-detail-row">
                    <span class="detail-label">${_phoneText('appearance')}</span>
                    <span class="detail-value">${this.escapeHtml(contact.appearance)}</span>
                </div>`
                    : ''
                }
                ${
                  contact.clothing
                    ? `<div class="contact-detail-row">
                    <span class="detail-label">${_phoneText('clothing')}</span>
                    <span class="detail-value">${this.escapeHtml(contact.clothing)}</span>
                </div>`
                    : ''
                }
                ${
                  contact.cognitive_state
                    ? `<div class="contact-detail-row">
                    <span class="detail-label">${_phoneText('cognition')}</span>
                    <span class="detail-value">${this.escapeHtml(contact.cognitive_state)}</span>
                </div>`
                    : ''
                }
                `;
      } else {
        // 预定义角色:显示原有字段
        detailFields = `
                <div class="contact-detail-row">
                    <span class="detail-label">${_phoneText('age')}</span>
                    <span class="detail-value">${this.escapeHtml(String(contact.age))}</span>
                </div>
                <div class="contact-detail-row">
                    <span class="detail-label">${_phoneText('personality')}</span>
                    <span class="detail-value">${contact.personality}</span>
                </div>
                `;
      }

      detailContainer.innerHTML = `
                <div class="contact-detail-header${headerClass}">
                    <div class="contact-detail-avatar${avatarToneClass}">
                        ${(contact.name || '?').charAt(0)}
                    </div>
                    <div class="contact-detail-name">${this.escapeHtml(contact.name)}${typeBadge}</div>
                    <div class="contact-detail-personality">${this.escapeHtml(contact.personality)}</div>
                </div>
                <div class="contact-detail-actions">
                    <button class="" data-action="contact-action-btn" data-action="sms">
                        <span class="material-symbols-outlined contact-action-icon">chat</span>
                        <span class="contact-action-label">${_phoneText('sendSms')}</span>
                    </button>
                </div>
                <div class="contact-detail-section">
                    ${detailFields}
                </div>
            `;

      // 绑定发短信按键
      const smsBtn = detailContainer.querySelector('[data-action="sms"]');
      if (smsBtn) {
        smsBtn.addEventListener('click', () => {
          this.currentApp = 'sms';
          this.openChat(contactId);
        });
      }
    }
  }

  // 显示联系人列表
  showContactList() {
    this.currentContact = null;

    this.hideAllViews();
    document.getElementById('phone-contact-list').classList.remove('hidden');

    // 底部导航高亮 SMS
    this.syncHeaderChrome();
    document.getElementById('phone-back-btn').classList.add('hidden');
    document.getElementById('phone-title').textContent = _phoneText('sms');
    this.hideSubtitle();
    this.syncNavActive('sms');

    // 渲染联系人列表(只显示有聊天记录的)
    const listEl = document.getElementById('contact-list');
    const allContacts = smsService.getContacts();

    // 只保留有聊天记录的联系人
    const contacts = allContacts.filter(c => c.messageCount > 0);

    if (contacts.length === 0) {
      listEl.innerHTML = `<div class="contact-empty">${_phoneText('noSms')}</div>`;
      return;
    }

    // 分组:预定义角色和临时角色
    const systemContacts = contacts.filter(c => c.type === 'system' || !c.type);
    const dynamicContacts = contacts.filter(c => c.type === 'dynamic');

    let html = '';

    // 临时角色组(优先显示)
    if (dynamicContacts.length > 0) {
      html += `<div class="contact-group-header"><span class="material-symbols-outlined">auto_awesome</span> ${_phoneText('dynamicGroup')}</div>`;
      html += dynamicContacts.map(contact => this.renderContactItem(contact, true)).join('');
    }

    // 预定义角色组
    if (systemContacts.length > 0) {
      html += `<div class="contact-group-header"><span class="material-symbols-outlined">favorite</span> ${_phoneText('predefinedGroup')}</div>`;
      html += systemContacts.map(contact => this.renderContactItem(contact)).join('');
    }

    listEl.innerHTML = html;

    // 绑定点击事件
    listEl.querySelectorAll('.contact-item').forEach(item => {
      item.addEventListener('click', e => {
        // 如果点击的是删除按键，不进入聊天
        if (e.target.closest('[data-action~="contact-btn-danger"]')) return;
        const contactId = item.dataset.contactId;
        this.openChat(contactId);
      });
    });

    // 绑定删除按键事件
    listEl.querySelectorAll('[data-action~="contact-btn-danger"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const contactId = btn.dataset.contactId;
        this.deleteConversation(contactId);
      });
    });
  }

  // 渲染单个联系人项(短信列表用)
  renderContactItem(contact, isDynamic = false) {
    const lastMsg = contact.lastMessage;
    const preview = lastMsg
      ? (lastMsg.role === 'user' ? _phoneText('youPrefix') : '') +
        this.truncate(lastMsg.content, 30)
      : _phoneText('startChat');
    const hasHistory = contact.messageCount > 0;
    const unreadBadge =
      contact.unreadCount > 0
        ? `<span class="contact-unread-badge">${contact.unreadCount > 99 ? '99+' : contact.unreadCount}</span>`
        : '';
    const dynamicClass = isDynamic ? ' contact-dynamic' : '';
    const personalityTag =
      isDynamic && contact.personality
        ? `<span class="contact-personality-tag">${this.escapeHtml(contact.personality)}</span>`
        : '';

    return `
            <div class="contact-item${dynamicClass}" data-contact-id="${contact.id}">
                <div class="contact-avatar${isDynamic ? ' dynamic' : ''}">
                    ${(contact.name || '?').charAt(0)}
                    ${unreadBadge}
                </div>
                <div class="contact-info">
                    <div class="contact-name">${this.escapeHtml(contact.name)}${personalityTag}</div>
                    <div class="contact-preview">${this.escapeHtml(preview)}</div>
                </div>
                ${hasHistory ? `<button class="" data-action="contact-btn-danger" data-contact-id="${contact.id}" title="${_phoneText('deleteConversationTitle')}"><span class="material-symbols-outlined">delete</span></button>` : '<span class="material-symbols-outlined contact-arrow">chevron_right</span>'}
            </div>
        `;
  }

  // 删除整个对话
  deleteConversation(contactId) {
    this.pendingDeleteContactId = contactId;
    // 使用统一接口获取联系人信息
    const contact = getContactInfo(contactId);
    document.getElementById('sms-delete-conv-text').textContent = _phoneText(
      'deleteConversationText',
      { name: contact?.name }
    );
    document.getElementById('sms-delete-conv-modal').classList.remove('hidden');
  }

  // 确认删除对话
  confirmDeleteConversation() {
    const contactId = this.pendingDeleteContactId;
    if (contactId) {
      smsService.deleteConversation(contactId);
      this.showContactList();
      showToast(_phoneText('conversationDeleted'));
    }
    this.cancelDeleteConversation();
  }

  // 取消删除对话
  cancelDeleteConversation() {
    this.pendingDeleteContactId = null;
    document.getElementById('sms-delete-conv-modal').classList.add('hidden');
  }

  // 打开聊天界面
  openChat(contactId) {
    // 使用统一接口获取联系人信息
    const contact = getContactInfo(contactId);
    if (!contact) return;

    this.currentContact = contactId;

    // 切换视图
    this.hideAllViews();
    document.getElementById('phone-chat-view').classList.remove('hidden');

    this.syncHeaderChrome();
    document.getElementById('phone-back-btn').classList.remove('hidden');
    document.getElementById('phone-title').textContent = contact.name;
    this.syncNavActive('sms');

    // 渲染聊天历史
    this.renderChatHistory();

    // 标记消息为已读
    smsService.markAsRead(contactId);

    // 设置输入框占位符并聚焦
    const smsInput = document.getElementById('sms-input');
    smsInput.placeholder = _phoneIsEnglish() ? 'Trace your thoughts here...' : '写下你的涂鸦想法...';
    smsInput.focus();
  }

  // 渲染聊天历史
  renderChatHistory() {
    const messagesEl = document.getElementById('sms-messages');
    const history = smsService.getConversation(this.currentContact);

    if (history.length === 0) {
      messagesEl.innerHTML = `
                <div class="sms-empty">
                    <div class="sms-empty-icon"><span class="material-symbols-outlined">chat</span></div>
                    <div class="sms-empty-text">${_phoneText('startConversation')}</div>
                </div>
            `;
      return;
    }

    messagesEl.innerHTML = history
      .map((msg, index) => {
        // 判断消息类型对应的样式类
        const bubbleClass =
          msg.role === 'user' ? 'sms-sent' : msg.role === 'system' ? 'sms-system' : 'sms-received';

        // 系统消息和事件驱动消息不显示重新生成和编辑按键
        const isSystem = msg.role === 'system';
        const isEventDriven = msg.isEventDriven === true;
        const hideRegenEdit = isSystem || isEventDriven;

        // 注入状态图标:🔴 = new(未注入)，✅ = injected(已注入)
        // 玩家消息显示在左下角，AI/系统消息显示在右下角
        const statusIcon =
          msg.injectionStatus === 'injected' ? 'check_circle' : 'radio_button_unchecked';
        const statusClass = msg.role === 'user' ? 'sms-status-left' : 'sms-status-right';
        const statusTitle =
          msg.injectionStatus === 'injected' ? _phoneText('synced') : _phoneText('pendingSync');

        return `
            <div class="sms-bubble ${bubbleClass}" data-msg-index="${index}">
                <div class="sms-content">${this.escapeHtml(msg.content)}</div>
                <div class="sms-time">${this.formatTime(msg)}</div>
                <span class="sms-injection-status ${statusClass}" title="${statusTitle}"><span class="material-symbols-outlined">${statusIcon}</span></span>
                <div class="sms-actions">
                    <button class="btn-ghost btn-icon" data-action="sms-action-btn" data-sms-action="copy" title="${_phoneText('copy')}"><span class="material-symbols-outlined">content_copy</span></button>
                    ${hideRegenEdit ? '' : `<button class="btn-ghost btn-icon" data-action="sms-action-btn" data-sms-action="regenerate" title="${_phoneText('regenerate')}"><span class="material-symbols-outlined">refresh</span></button>`}
                    <button class="btn-danger btn-icon" data-action="sms-action-btn" data-sms-action="delete" title="${_phoneText('delete')}"><span class="material-symbols-outlined">delete</span></button>
                    ${hideRegenEdit ? '' : `<button class="btn-ghost btn-icon" data-action="sms-action-btn" data-sms-action="edit" title="${_phoneText('edit')}"><span class="material-symbols-outlined">edit</span></button>`}
                </div>
            </div>`;
      })
      .join('');

    // 绑定操作按键事件
    this.bindMessageActions();

    // 更新副标题(显示最新的地点和认知状态)
    this.updateSubtitle(history);

    // 滚动到底部
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // 更新副标题(显示角色的关系、地点和认知状态，分三行)
  updateSubtitle(history) {
    const subtitleEl = document.getElementById('phone-subtitle');
    if (!subtitleEl) return;

    // 找到最新的 AI 回复，获取 location、cognitive_state 和 relationship
    const lastAIMsg = [...history].reverse().find(m => m.role === 'assistant');

    if (lastAIMsg && (lastAIMsg.location || lastAIMsg.cognitive_state || lastAIMsg.relationship)) {
      const lines = [];

      // 第一行:关系
      if (lastAIMsg.relationship && lastAIMsg.relationship !== _phoneText('unknown')) {
        lines.push(`${_phoneText('relationshipLabel')}: ${lastAIMsg.relationship}`);
      }

      // 第二行:地点
      if (lastAIMsg.location && lastAIMsg.location !== _phoneText('unknown')) {
        lines.push(`${_phoneText('locationLabel')}: ${lastAIMsg.location}`);
      }

      // 第三行:认知状态
      if (lastAIMsg.cognitive_state && lastAIMsg.cognitive_state !== _phoneText('unknown')) {
        lines.push(`${_phoneText('cognitionLabel')}: ${lastAIMsg.cognitive_state}`);
      }

      if (lines.length > 0) {
        subtitleEl.innerHTML = lines.map(l => this.escapeHtml(l)).join('<br>');
        subtitleEl.classList.remove('hidden');
      } else {
        this.hideSubtitle();
      }
    } else {
      this.hideSubtitle();
    }
  }

  // 隐藏副标题
  hideSubtitle() {
    const subtitleEl = document.getElementById('phone-subtitle');
    if (subtitleEl) {
      subtitleEl.classList.add('hidden');
    }
  }

  // 绑定消息操作按键事件
  bindMessageActions() {
    const messagesEl = document.getElementById('sms-messages');

    // 复制
    messagesEl.querySelectorAll('[data-sms-action="copy"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const index = parseInt(btn.closest('.sms-bubble').dataset.msgIndex);
        this.copyMessage(index);
      });
    });

    // 重新生成
    messagesEl.querySelectorAll('[data-sms-action="regenerate"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const index = parseInt(btn.closest('.sms-bubble').dataset.msgIndex);
        this.regenerateMessage(index);
      });
    });

    // 删除
    messagesEl.querySelectorAll('[data-sms-action="delete"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const index = parseInt(btn.closest('.sms-bubble').dataset.msgIndex);
        this.deleteMessage(index);
      });
    });

    // 编辑
    messagesEl.querySelectorAll('[data-sms-action="edit"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const index = parseInt(btn.closest('.sms-bubble').dataset.msgIndex);
        this.editMessage(index);
      });
    });
  }

  // 复制消息（兼容 iOS Safari）
  copyMessage(index) {
    const history = smsService.getConversation(this.currentContact);
    if (index >= history.length) return;

    const text = history[index].content;

    // 直接使用 execCommand 后备方案，避免 clipboard API 在 iOS 上的问题
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    // iOS Safari 需要 setSelectionRange
    textarea.setSelectionRange(0, text.length);

    let success = false;
    try {
      success = document.execCommand('copy');
    } catch (e) {
      console.error('[PhoneUI] Copy failed:', e);
    }

    document.body.removeChild(textarea);
    showToast(success ? _phoneText('copied') : _phoneText('copyFailed'));
  }

  // 重新生成消息
  async regenerateMessage(index) {
    if (this.isLoading) return;

    const history = smsService.getConversation(this.currentContact);
    if (index >= history.length) return;

    const msg = history[index];

    if (msg.role === 'assistant') {
      // AI 消息:删除它及之后的内容，找到对应的用户消息重新生成
      let userMsgIndex = index - 1;
      while (userMsgIndex >= 0 && history[userMsgIndex].role !== 'user') {
        userMsgIndex--;
      }

      if (userMsgIndex < 0) {
        showToast(_phoneText('noUserMessage'));
        return;
      }

      const userMessage = history[userMsgIndex].content;

      // 重置对应用户消息的注入状态为 new，让主聊天能看到完整上下文
      if (history[userMsgIndex].injectionStatus === 'injected') {
        history[userMsgIndex].injectionStatus = 'new';
        delete history[userMsgIndex].injectedAtTurn;
      }

      // 删除从 AI 消息开始到最后的所有消息
      smsService.truncateConversation(this.currentContact, index);

      // 立刻刷新界面显示删除后的状态
      this.renderChatHistory();

      // 显示加载状态
      this.isLoading = true;
      this.showTypingIndicator();

      try {
        await smsService.regenerateReply(this.currentContact, userMessage);
        this.hideTypingIndicator();
        this.renderChatHistory();
        showToast(_phoneText('regenerated'));
      } catch (error) {
        this.hideTypingIndicator();
        this.appendMessage('system', _phoneText('regenerateFailed', { error: error.message }));
      } finally {
        this.isLoading = false;
      }
    } else {
      // 用户消息:保留这条消息，删除之后的内容，重新生成 AI 回复
      const userMessage = msg.content;

      // 重置用户消息的注入状态为 new，让主聊天能看到完整上下文
      if (msg.injectionStatus === 'injected') {
        msg.injectionStatus = 'new';
        delete msg.injectedAtTurn;
      }

      // 保留用户消息，删除之后的内容(index + 1 及之后)
      smsService.truncateConversation(this.currentContact, index + 1);

      // 立刻刷新界面显示删除后的状态
      this.renderChatHistory();

      // 显示加载状态
      this.isLoading = true;
      this.showTypingIndicator();

      try {
        // 使用 regenerateReply(不会重复添加用户消息)
        await smsService.regenerateReply(this.currentContact, userMessage);
        this.hideTypingIndicator();
        this.renderChatHistory();
        showToast(_phoneText('regenerated'));
      } catch (error) {
        this.hideTypingIndicator();
        this.appendMessage('system', _phoneText('regenerateFailed', { error: error.message }));
      } finally {
        this.isLoading = false;
      }
    }
  }

  // 删除消息 - 显示确认弹窗
  deleteMessage(index) {
    this.pendingDeleteIndex = index;
    document.getElementById('sms-delete-confirm-modal').classList.remove('hidden');
  }

  // 确认删除消息
  confirmDeleteMessage() {
    const index = this.pendingDeleteIndex;
    if (index === null) return;

    if (smsService.deleteMessage(this.currentContact, index)) {
      this.renderChatHistory();
      showToast(_phoneText('messageDeleted'));
    }

    this.cancelDeleteMessage();
  }

  // 取消删除消息
  cancelDeleteMessage() {
    this.pendingDeleteIndex = null;
    document.getElementById('sms-delete-confirm-modal').classList.add('hidden');
  }

  // 编辑消息
  editMessage(index) {
    const history = smsService.getConversation(this.currentContact);
    if (index >= history.length) return;

    const msg = history[index];
    const bubble = document.querySelector(`.sms-bubble[data-msg-index="${index}"]`);
    if (!bubble) return;

    const contentEl = bubble.querySelector('.sms-content');
    const actionsEl = bubble.querySelector('.sms-actions');

    // 隐藏操作按键
    if (actionsEl) actionsEl.style.display = 'none';

    // 创建编辑界面
    contentEl.innerHTML = '';

    const textarea = document.createElement('textarea');
    textarea.className = 'sms-edit-textarea';
    textarea.value = msg.content;

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'sms-edit-buttons';
    buttonContainer.innerHTML = `
            <button class="sms-edit-save">${_phoneText('save')}</button>
            <button class="sms-edit-cancel">${_phoneText('cancel')}</button>
        `;

    contentEl.appendChild(textarea);
    contentEl.appendChild(buttonContainer);
    textarea.focus();

    // 保存
    buttonContainer.querySelector('.sms-edit-save').addEventListener('click', () => {
      const newText = textarea.value.trim();
      if (newText) {
        smsService.updateMessage(this.currentContact, index, newText);
        this.renderChatHistory();
        showToast(_phoneText('saved'));
      } else {
        // 内容为空时取消编辑，恢复原内容
        this.renderChatHistory();
      }
    });

    // 取消
    buttonContainer.querySelector('.sms-edit-cancel').addEventListener('click', () => {
      this.renderChatHistory();
    });
  }

  // 发送消息
  async sendMessage() {
    if (this.isLoading || !this.currentContact) return;

    const input = document.getElementById('sms-input');
    const message = input.value.trim();
    if (!message) return;

    // 清空输入框
    input.value = '';

    // 显示用户消息
    this.appendMessage('user', message);

    // 显示加载状态
    this.isLoading = true;
    this.showTypingIndicator();

    try {
      // 发送消息并获取回复
      await smsService.sendMessage(this.currentContact, message);

      // 移除加载指示器
      this.hideTypingIndicator();

      // 重新渲染以显示完整历史
      this.renderChatHistory();
    } catch (error) {
      console.error('Failed to send SMS:', error);
      this.hideTypingIndicator();
      this.appendMessage('system', _phoneText('sendFailed', { error: error.message }));
    } finally {
      this.isLoading = false;
    }
  }

  // 添加消息到聊天区
  appendMessage(role, content) {
    const messagesEl = document.getElementById('sms-messages');

    // 移除空状态
    const emptyEl = messagesEl.querySelector('.sms-empty');
    if (emptyEl) {
      emptyEl.remove();
    }

    const bubbleClass =
      role === 'user' ? 'sms-sent' : role === 'assistant' ? 'sms-received' : 'sms-system';

    // 创建临时消息对象以获取格式化时间
    const tempMsg = { gameTime: this._getCurrentGameTime() };

    const bubble = document.createElement('div');
    bubble.className = `sms-bubble ${bubbleClass}`;
    bubble.innerHTML = `
            <div class="sms-content">${this.escapeHtml(content)}</div>
            <div class="sms-time">${this.formatTime(tempMsg)}</div>
        `;

    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // 获取当前游戏时间(直接使用 timelineService)
  _getCurrentGameTime() {
    if (typeof timelineService !== 'undefined') {
      return timelineService.getCurrentDate();
    }
    return null;
  }

  // 显示正在输入指示器
  showTypingIndicator() {
    const messagesEl = document.getElementById('sms-messages');
    const indicator = document.createElement('div');
    indicator.className = 'sms-bubble sms-received sms-typing';
    indicator.id = 'typing-indicator';
    const typingText = _phoneIsEnglish() ? 'Character is drawing...' : '角色正在书写...';
    indicator.innerHTML = `
            <div class="sms-typing-content">
                <div class="typing-dots">
                    <span></span><span></span><span></span>
                </div>
                <span class="sms-typing-text">${typingText}</span>
            </div>
        `;
    messagesEl.appendChild(indicator);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // 隐藏正在输入指示器
  hideTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) {
      indicator.remove();
    }
  }

  // 格式化时间(使用消息保存的游戏时间)
  formatTime(msg) {
    const timeTerms = window.worldMeta?.getActiveTimeTerms?.();
    const eraPrefix = timeTerms?.era || '';

    const formatGameTime = gt => {
      const timeStr = gt.timeStr || '--:--';
      return `${eraPrefix}${gt.year}.${gt.month}.${gt.day} ${timeStr}`;
    };

    // 优先使用消息中保存的游戏时间
    if (msg && msg.gameTime) {
      return formatGameTime(msg.gameTime);
    }

    // Fallback:如果消息没有时间戳，使用当前游戏时间
    if (typeof timelineService !== 'undefined') {
      const gameDate = timelineService.getCurrentDate();
      if (gameDate) {
        return formatGameTime(gameDate);
      }
    }
    // 如果没有游戏时间，显示占位符
    return _phoneText('gameTimeUnknown');
  }

  // 截断文本
  truncate(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  // HTML 转义
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// SMS 徽章更新处理函数（提取出来方便复用）
function handleSmsUnreadUpdate({ count }) {
  const badgeText = count > 99 ? '99+' : count;

  // 更新主屏幕短信图标红点
  const appBadge = document.getElementById('sms-app-badge');
  if (appBadge) {
    if (count > 0) {
      appBadge.textContent = badgeText;
      appBadge.classList.remove('hidden');
    } else {
      appBadge.classList.add('hidden');
    }
  }

  // SMS stage 当前处于 coming-soon 状态——SMS 入口角标全部强制隐藏，不跟随未读数变动
  [
    document.getElementById('phone-btn-badge'),
    document.getElementById('stage-nav-sms-badge'),
    document.querySelector('.stage-mobile-bar .stage-nav-btn[data-stage-target="sms"] .header-badge'),
  ].forEach(node => {
    if (node) node.classList.add('hidden');
  });
}

// 页面加载后初始化
const _initPhoneUI = () => {
  window.phoneUI = new PhoneUI();

  // 订阅 EventBus 事件：统一处理 SMS 徽章更新
  if (window.eventBus && window.GameEvents) {
    window.eventBus.on(window.GameEvents.SMS_UNREAD_UPDATED, handleSmsUnreadUpdate);
    console.log('[PhoneUI] EventBus SMS_UNREAD_UPDATED 监听器已注册');
  }

  // 初始化时主动同步一次徽章状态（修复时序问题：game.js 的 loadGame 可能在此之前已执行）
  if (typeof smsService !== 'undefined') {
    const count = smsService.getTotalUnreadCount();
    handleSmsUnreadUpdate({ count });
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initPhoneUI);
} else {
  queueMicrotask(_initPhoneUI);
}
