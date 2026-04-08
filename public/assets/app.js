(function () {
  const API_BASE = '';
  const STORAGE_KEY = 'chirply_user';

  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const page = document.body.dataset.page;

  const state = {
    currentUser: readUser(),
    feedPosts: [],
    feedSearch: '',
    feedSort: 'recent',
    topics: [],
    topicFilter: '',
    draftLoaded: null,
    isPublishing: false,
  };

  function readUser() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveUser(user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    state.currentUser = user;
  }

  function clearUser() {
    localStorage.removeItem(STORAGE_KEY);
    state.currentUser = null;
  }

  function authHeaders(extra = {}) {
    return state.currentUser?.id ? { 'x-user-id': state.currentUser.id, ...extra } : extra;
  }

  async function api(path, options = {}) {
    const isFormData = options.body instanceof FormData;
    const headers = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {})
    };

    const res = await fetch(API_BASE + path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  function setNavState() {
    qsa('.nav a').forEach((link) => {
      const href = link.getAttribute('href');
      const expected = page === 'landing' ? 'index.html' : `${page}.html`;
      if (href === expected) link.classList.add('active');
    });
  }

  function updateHeaderAuth() {
    const topActions = qs('.top-actions');
    if (!topActions) return;
    if (state.currentUser) {
      topActions.innerHTML = `
        <a class="pill-btn" href="profile.html">${escapeHtml(state.currentUser.name || state.currentUser.username || 'Profile')}</a>
        <button class="pill-btn ghost" id="logoutBtn" type="button">Logout</button>
      `;
      qs('#logoutBtn', topActions)?.addEventListener('click', () => {
        clearUser();
        location.href = 'index.html';
      });
    } else {
      topActions.innerHTML = `<a class="pill-btn" href="login.html">Login</a>`;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    if (!iso) return 'Just now';
    const date = new Date(iso);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function wordCount(text) {
    const trimmed = String(text || '').trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  function readTime(text) {
    return Math.max(1, Math.ceil(wordCount(text) / 200));
  }

  function mediaMarkup(media) {
    if (!media?.url) return '';
    if (media.type === 'video') {
      const poster = media.poster ? ` poster="${escapeHtml(media.poster)}"` : '';
      return `<div class="post-media"><video controls preload="metadata"${poster} src="${escapeHtml(media.url)}"></video></div>`;
    }
    return `<div class="post-media"><img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.originalName || 'Post media')}" /></div>`;
  }

  function reactionButton(type, count, active, postId, disabled = false) {
    const icon = { smile: '😊', heart: '❤️', laugh: '😂' }[type] || '✨';
    const classes = ['reaction-btn'];
    if (active) classes.push('active');
    const attrs = [
      `data-reaction="${type}"`,
      postId ? `data-post-id="${postId}"` : '',
      disabled ? 'disabled' : ''
    ].filter(Boolean).join(' ');
    return `<button class="${classes.join(' ')}" ${attrs}>${icon} <span>${count ?? 0}</span></button>`;
  }

  function postCardMarkup(post, showBody = false) {
    const author = post.author || { name: 'Unknown', username: '@unknown', avatar: 'U' };
    const tags = (post.tags || []).map((tag) => `<span class="chip">#${escapeHtml(tag)}</span>`).join(' ');
    const body = showBody ? escapeHtml(post.content || '') : escapeHtml(post.excerpt || post.content || '');
    const ownerActions = post.canDelete ? `
      <div class="row gap wrap owner-actions">
        <a class="pill-btn ghost" href="post.html?id=${encodeURIComponent(post.id)}">${post.commentCount || 0} comments</a>
        <button class="pill-btn ghost" type="button" data-delete-post="${escapeHtml(post.id)}">Delete post</button>
      </div>
    ` : `<a class="pill-btn ghost" href="post.html?id=${encodeURIComponent(post.id)}">${post.commentCount || 0} comments</a>`;
    return `
      <article class="post-card" data-post-id="${escapeHtml(post.id)}">
        <div class="row gap">
          <div class="avatar">${escapeHtml(author.avatar || 'U')}</div>
          <div>
            <h4>${escapeHtml(author.name)}</h4>
            <p class="muted">${escapeHtml(author.username)} • ${formatDate(post.createdAt)} • ${post.readTime || readTime(post.content)} min read</p>
          </div>
        </div>
        <div>
          <a href="post.html?id=${encodeURIComponent(post.id)}"><h3>${escapeHtml(post.title)}</h3></a>
          <p class="${showBody ? 'body' : 'excerpt'}">${body}</p>
        </div>
        ${post.media ? mediaMarkup(post.media) : ''}
        <div class="row between wrap gap">
          <div class="chips">${tags || '<span class="chip">#general</span>'}</div>
          ${ownerActions}
        </div>
        <div class="reactions" data-reaction-group="${escapeHtml(post.id)}">
          ${reactionButton('smile', post.reactionCounts?.smile, post.userReactions?.smile, post.id, !state.currentUser)}
          ${reactionButton('heart', post.reactionCounts?.heart, post.userReactions?.heart, post.id, !state.currentUser)}
          ${reactionButton('laugh', post.reactionCounts?.laugh, post.userReactions?.laugh, post.id, !state.currentUser)}
        </div>
      </article>
    `;
  }

  async function handleReaction(postId, reaction, groupEl) {
    if (!state.currentUser) {
      location.href = 'login.html';
      return;
    }
    try {
      const data = await api(`/api/posts/${encodeURIComponent(postId)}/react`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ reaction })
      });
      ['smile', 'heart', 'laugh'].forEach((type) => {
        const btn = qs(`[data-reaction="${type}"]`, groupEl);
        if (!btn) return;
        btn.classList.toggle('active', Boolean(data.userReactions?.[type]));
        const span = qs('span', btn);
        if (span) span.textContent = data.reactionCounts?.[type] ?? 0;
      });
    } catch (err) {
      alert(err.message);
    }
  }

  function attachReactionHandlers(root = document) {
    qsa('[data-reaction-group]', root).forEach((group) => {
      group.addEventListener('click', (event) => {
        const button = event.target.closest('.reaction-btn[data-post-id][data-reaction]');
        if (!button || button.disabled) return;
        handleReaction(button.dataset.postId, button.dataset.reaction, group);
      });
    });
  }

  async function handleDeletePost(postId) {
    if (!ensureAuth()) return;
    const ok = window.confirm('Delete this post permanently?');
    if (!ok) return;
    try {
      await api(`/api/posts/${encodeURIComponent(postId)}`, {
        method: 'DELETE',
        headers: authHeaders()
      });

      if (page === 'profile') {
        await initProfile();
        return;
      }
      if (page === 'post') {
        location.href = 'profile.html';
        return;
      }
      location.reload();
    } catch (err) {
      alert(err.message);
    }
  }

  function attachDeleteHandlers(root = document) {
    qsa('[data-delete-post]', root).forEach((button) => {
      if (button.dataset.deleteBound === 'true') return;
      button.dataset.deleteBound = 'true';
      button.addEventListener('click', () => handleDeletePost(button.dataset.deletePost));
    });
  }

  function showMessage(target, message, type = 'error') {
    if (!target) return;
    target.className = `${type}-box`;
    target.classList.remove('hidden');
    target.textContent = message;
  }

  function hideMessage(target) {
    if (!target) return;
    target.classList.add('hidden');
    target.textContent = '';
  }

  function friendlyLoadMessage(kind = 'content') {
    const messages = {
      feed: 'Unable to load the feed right now. Please try again in a moment.',
      landing: 'Featured content is temporarily unavailable.',
      post: 'Unable to load this post right now.',
      profile: 'Unable to load your profile right now.',
      explore: 'Unable to load topics right now.'
    };
    return messages[kind] || 'Something went wrong while loading content.';
  }

  function ensureAuth(redirect = true) {
    if (state.currentUser) return true;
    if (redirect) location.href = 'login.html';
    return false;
  }

  async function initLanding() {
    const titleEl = qs('#landingFeaturedTitle');
    const bodyEl = qs('#landingFeaturedBody');
    if (!titleEl || !bodyEl) return;
    try {
      const data = await api(`/api/landing${state.currentUser?.id ? `?userId=${encodeURIComponent(state.currentUser.id)}` : ''}`);
      const featured = data.featured;
      if (!featured) return;
      titleEl.textContent = featured.title;
      bodyEl.textContent = featured.excerpt;
      const group = qs('#landingFeaturedReactions');
      if (group) {
        group.innerHTML = [
          reactionButton('smile', featured.reactionCounts?.smile, featured.userReactions?.smile, featured.id, !state.currentUser),
          reactionButton('heart', featured.reactionCounts?.heart, featured.userReactions?.heart, featured.id, !state.currentUser),
          reactionButton('laugh', featured.reactionCounts?.laugh, featured.userReactions?.laugh, featured.id, !state.currentUser)
        ].join('');
        group.dataset.reactionGroup = featured.id;
        attachReactionHandlers(group.parentElement || document);
      }
    } catch (err) {
      console.error(err);
      titleEl.textContent = 'Welcome to Chirply';
      bodyEl.textContent = friendlyLoadMessage('landing');
    }
  }

  function initSignup() {
    const form = qs('#signupForm');
    if (!form) return;
    const errorBox = qs('#signupErrors');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      hideMessage(errorBox);
      const name = qs('#name').value.trim();
      const email = qs('#email').value.trim();
      const username = qs('#username').value.trim();
      const password = qs('#password').value;
      const confirmPassword = qs('#confirmPassword').value;
      if (password !== confirmPassword) {
        showMessage(errorBox, 'Passwords do not match.');
        return;
      }
      try {
        const data = await api('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ name, email, username, password })
        });
        saveUser(data.user);
        location.href = 'feed.html';
      } catch (err) {
        showMessage(errorBox, err.message);
      }
    });
  }

  function initLogin() {
    const form = qs('#loginForm');
    if (!form) return;
    const errorBox = qs('#loginErrors');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      hideMessage(errorBox);
      try {
        const data = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: qs('#loginEmail').value.trim(),
            password: qs('#loginPassword').value
          })
        });
        saveUser(data.user);
        location.href = 'feed.html';
      } catch (err) {
        showMessage(errorBox, err.message);
      }
    });
  }

  async function initFeed() {
    const feedList = qs('#feedList');
    if (!feedList) return;
    const feedEmpty = qs('#feedEmpty');
    const searchInput = qs('#feedSearch');
    const sortSelect = qs('#feedSort');
    const trendingChips = qs('#trendingChips');

    try {
      const data = await api(`/api/posts${state.currentUser?.id ? `?userId=${encodeURIComponent(state.currentUser.id)}` : ''}`);
      state.feedPosts = data.posts || [];
      renderFeed();
      trendingChips.innerHTML = (data.trendingTags || []).map(({ tag, count }) => `
        <button class="chip" type="button" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)} <span class="muted">${count}</span></button>
      `).join('') || '<span class="muted small">No tags yet.</span>';
      qsa('[data-tag]', trendingChips).forEach((btn) => btn.addEventListener('click', () => {
        searchInput.value = btn.dataset.tag;
        state.feedSearch = btn.dataset.tag;
        renderFeed();
      }));
    } catch (err) {
      console.error(err);
      feedList.innerHTML = `<div class="empty-state">${escapeHtml(friendlyLoadMessage('feed'))}</div>`;
      if (trendingChips) trendingChips.innerHTML = '<span class="muted small">Trending tags will appear here.</span>';
      feedEmpty.classList.add('hidden');
    }

    searchInput?.addEventListener('input', () => {
      state.feedSearch = searchInput.value.trim().toLowerCase();
      renderFeed();
    });

    sortSelect?.addEventListener('change', () => {
      state.feedSort = sortSelect.value;
      renderFeed();
    });

    function renderFeed() {
      let posts = [...state.feedPosts];
      if (state.feedSearch) {
        posts = posts.filter((post) => {
          const hay = [post.title, post.content, post.author?.name, post.author?.username, ...(post.tags || [])].join(' ').toLowerCase();
          return hay.includes(state.feedSearch);
        });
      }
      if (state.feedSort === 'popular') {
        posts.sort((a, b) => (b.reactionCounts?.total || 0) - (a.reactionCounts?.total || 0) || new Date(b.createdAt) - new Date(a.createdAt));
      } else {
        posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      }
      feedList.innerHTML = posts.map((post) => postCardMarkup(post)).join('');
      feedEmpty.classList.toggle('hidden', posts.length > 0);
      attachReactionHandlers(feedList);
      attachDeleteHandlers(feedList);
    }
  }

  function initCreate() {
    if (!ensureAuth()) return;
    const form = qs('#composeForm');
    if (!form) return;

    const fields = {
      title: qs('#postTitle'),
      tags: qs('#postTags'),
      content: qs('#postContent'),
      media: qs('#postMedia')
    };
    const countEls = { words: qs('#wordCount'), chars: qs('#charCount') };
    const errors = qs('#composeErrors');
    const preview = {
      title: qs('#previewTitle'),
      content: qs('#previewContent'),
      tags: qs('#previewTags'),
      readTime: qs('#previewReadTime'),
      author: qs('#previewAuthor'),
      mediaWrap: qs('#previewMediaWrap'),
      mediaBadge: qs('#previewMediaBadge'),
      mediaName: qs('#previewMediaName'),
      mediaFrame: qs('#previewMediaFrame')
    };
    const mediaInfo = {
      box: qs('#mediaInfoBox'),
      name: qs('#mediaFileName'),
      meta: qs('#mediaFileMeta')
    };

    preview.author.textContent = state.currentUser?.name || state.currentUser?.username || 'Your account';

    function updatePreview() {
      const title = fields.title.value.trim();
      const tags = fields.tags.value.trim();
      const content = fields.content.value;
      const words = wordCount(content);
      countEls.words.textContent = words;
      countEls.chars.textContent = content.length;
      preview.title.textContent = title || 'Your title will appear here';
      preview.content.textContent = content.trim() || 'Start typing to see a preview of your content...';
      preview.tags.textContent = tags ? tags.split(',').map((tag) => `#${tag.trim().replace(/^#/, '')}`).filter(Boolean).join(' ') : '#general';
      preview.readTime.textContent = readTime(content);
    }

    function updateMediaPreview() {
      const file = fields.media.files?.[0];
      if (!file) {
        mediaInfo.box.classList.add('hidden');
        preview.mediaWrap.classList.add('hidden');
        preview.mediaFrame.innerHTML = '<p class="muted small center">Media preview will appear here</p>';
        preview.mediaName.textContent = '';
        preview.mediaBadge.textContent = 'No Media';
        return;
      }

      const type = file.type.startsWith('video/') ? 'Video' : 'Image';
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      mediaInfo.box.classList.remove('hidden');
      mediaInfo.name.textContent = file.name;
      mediaInfo.meta.textContent = `${type} • ${sizeMb} MB`;
      preview.mediaWrap.classList.remove('hidden');
      preview.mediaName.textContent = file.name;
      preview.mediaBadge.textContent = type;

      const url = URL.createObjectURL(file);
      preview.mediaFrame.innerHTML = file.type.startsWith('video/')
          ? `<video controls preload="metadata" src="${url}"></video>`
          : `<img src="${url}" alt="Preview" />`;
    }

    function loadDraftToForm(draft) {
      if (!draft) return;
      fields.title.value = draft.title || '';
      fields.tags.value = draft.tags || '';
      fields.content.value = draft.content || '';
      updatePreview();
      if (draft.mediaName) {
        mediaInfo.box.classList.remove('hidden');
        mediaInfo.name.textContent = draft.mediaName;
        mediaInfo.meta.textContent = draft.mediaType ? `${draft.mediaType} (saved metadata)` : 'Saved media metadata';
      }
    }

    qsa('#postTitle, #postTags, #postContent').forEach((el) => el.addEventListener('input', updatePreview));
    fields.media.addEventListener('change', updateMediaPreview);
    qs('#removeMediaBtn')?.addEventListener('click', () => {
      fields.media.value = '';
      updateMediaPreview();
    });

    qs('#saveDraftBtn')?.addEventListener('click', async () => {
      hideMessage(errors);
      try {
        const body = {
          userId: state.currentUser.id,
          title: fields.title.value,
          tags: fields.tags.value,
          content: fields.content.value,
          mediaName: fields.media.files?.[0]?.name || '',
          mediaType: fields.media.files?.[0]?.type || ''
        };
        await api('/api/drafts/me', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(body)
        });
        showMessage(errors, 'Draft saved.', 'notice');
      } catch (err) {
        showMessage(errors, err.message);
      }
    });

    qs('#loadDraftBtn')?.addEventListener('click', async () => {
      hideMessage(errors);
      try {
        const data = await api('/api/drafts/me', { headers: authHeaders() });
        if (!data.draft) {
          showMessage(errors, 'No draft saved yet.', 'notice');
          return;
        }
        loadDraftToForm(data.draft);
        showMessage(errors, 'Draft loaded.', 'notice');
      } catch (err) {
        showMessage(errors, err.message);
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (state.isPublishing) return;
      hideMessage(errors);
      if (wordCount(fields.content.value) > 1000) {
        showMessage(errors, 'Content exceeds 1000 words.');
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      state.isPublishing = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.originalText = submitBtn.textContent;
        submitBtn.textContent = 'Publishing...';
      }

      try {
        const fd = new FormData();
        fd.append('userId', state.currentUser.id);
        fd.append('title', fields.title.value);
        fd.append('tags', fields.tags.value);
        fd.append('content', fields.content.value);
        if (fields.media.files?.[0]) fd.append('media', fields.media.files[0]);
        const data = await api('/api/posts', {
          method: 'POST',
          headers: authHeaders(),
          body: fd
        });
        location.href = `post.html?id=${encodeURIComponent(data.post.id)}`;
      } catch (err) {
        showMessage(errors, err.message);
      } finally {
        state.isPublishing = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset.originalText || 'Publish Post';
        }
      }
    });

    updatePreview();
  }

  async function initPost() {
    const postId = new URLSearchParams(location.search).get('id');
    const root = qs('#postDetailContent');
    if (!root || !postId) {
      if (root) root.innerHTML = '<div class="empty-state">Post ID missing from URL.</div>';
      return;
    }

    try {
      const data = await api(`/api/posts/${encodeURIComponent(postId)}${state.currentUser?.id ? `?userId=${encodeURIComponent(state.currentUser.id)}` : ''}`);
      root.innerHTML = postCardMarkup(data, true);
      attachReactionHandlers(root);
      attachDeleteHandlers(root);

      const commentList = qs('#commentList');
      commentList.innerHTML = (data.comments || []).map((comment) => `
        <div class="comment-card">
          <div class="row gap">
            <div class="avatar">${escapeHtml(comment.user.avatar || 'U')}</div>
            <div>
              <strong>${escapeHtml(comment.user.name)}</strong>
              <div class="muted small">${escapeHtml(comment.user.username)} • ${formatDate(comment.createdAt)}</div>
            </div>
          </div>
          <p>${escapeHtml(comment.text)}</p>
        </div>
      `).join('') || '<div class="empty-state">No comments yet.</div>';

      qs('#relatedPosts').innerHTML = (data.related || []).map((post) => `
        <li><a href="post.html?id=${encodeURIComponent(post.id)}">${escapeHtml(post.title)}</a><div class="muted small">${post.commentCount || 0} comments</div></li>
      `).join('') || '<li class="muted small">No related posts yet.</li>';
    } catch (err) {
      console.error(err);
      root.innerHTML = `<div class="empty-state">${escapeHtml(friendlyLoadMessage('post'))}</div>`;
    }

    qs('#commentForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!ensureAuth()) return;
      const input = qs('#commentInput');
      const text = input.value.trim();
      if (!text) return;
      try {
        await api(`/api/posts/${encodeURIComponent(postId)}/comments`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ text })
        });
        input.value = '';
        await initPost();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  async function initProfile() {
    if (!ensureAuth()) return;
    try {
      const data = await api('/api/users/me/profile', { headers: authHeaders() });
      qs('#profileAvatar').textContent = data.user.avatar;
      qs('#profileName').textContent = data.user.name;
      qs('#profileMeta').textContent = `${data.user.username} • ${data.user.bio || 'Chirply member'}`;
      qs('#statPosts').textContent = data.stats.posts;
      qs('#statReactions').textContent = data.stats.totalReactions ?? data.stats.reactions ?? 0;
      qs('#statDrafts').textContent = data.stats.drafts;

      qs('#publishedList').innerHTML = data.published.length ? data.published.map((post) => postCardMarkup(post)).join('') : '<div class="empty-state">No published posts yet.</div>';
      qs('#likedList').innerHTML = data.liked.length ? data.liked.map((post) => postCardMarkup(post)).join('') : '<div class="empty-state">No liked posts yet.</div>';
      qs('#draftList').innerHTML = data.drafts.length ? data.drafts.map((draft) => `
        <article class="post-card">
          <h3>${escapeHtml(draft.title || 'Untitled draft')}</h3>
          <p class="excerpt">${escapeHtml((draft.content || '').slice(0, 180) || 'No content saved yet.')}</p>
          <div class="row between wrap gap">
            <span class="muted small">Updated ${formatDate(draft.updatedAt)}</span>
            <a class="pill-btn" href="create.html">Open in editor</a>
          </div>
        </article>
      `).join('') : '<div class="empty-state">No drafts saved.</div>';

      attachReactionHandlers(qs('#publishedList'));
      attachReactionHandlers(qs('#likedList'));
      attachDeleteHandlers(qs('#publishedList'));
      attachDeleteHandlers(qs('#likedList'));
    } catch (err) {
      console.error(err);
      qs('#tab-published').innerHTML = `<div class="empty-state">${escapeHtml(friendlyLoadMessage('profile'))}</div>`;
    }

    qsa('.tab-btn').forEach((btn) => btn.addEventListener('click', () => {
      qsa('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      qsa('.tab-content').forEach((tab) => tab.classList.toggle('active', tab.id === `tab-${btn.dataset.tab}`));
    }));
  }

  async function initExplore() {
    const grid = qs('#exploreGrid');
    if (!grid) return;
    const topicChips = qs('#topicChips');
    const trendingTopics = qs('#trendingTopics');
    const exploreEmpty = qs('#exploreEmpty');
    const search = qs('#exploreSearch');

    try {
      const data = await api(`/api/explore${state.currentUser?.id ? `?userId=${encodeURIComponent(state.currentUser.id)}` : ''}`);
      state.topics = data.topics || [];
      topicChips.innerHTML = state.topics.map((topic) => `<button class="chip" type="button" data-topic="${escapeHtml(topic.tag)}">#${escapeHtml(topic.tag)} <span class="muted">${topic.count}</span></button>`).join('');
      trendingTopics.innerHTML = (data.trending || []).map((topic) => `<li><strong>#${escapeHtml(topic.tag)}</strong><div class="muted small">${topic.count} posts</div></li>`).join('') || '<li class="muted small">Nothing trending yet.</li>';
      qsa('[data-topic]', topicChips).forEach((btn) => btn.addEventListener('click', () => {
        state.topicFilter = state.topicFilter === btn.dataset.topic ? '' : btn.dataset.topic;
        qsa('[data-topic]', topicChips).forEach((chip) => chip.classList.toggle('active', chip.dataset.topic === state.topicFilter));
        renderExplore();
      }));
      renderExplore();
    } catch (err) {
      console.error(err);
      grid.innerHTML = `<div class="empty-state">${escapeHtml(friendlyLoadMessage('explore'))}</div>`;
    }

    search?.addEventListener('input', renderExplore);

    function renderExplore() {
      const query = search.value.trim().toLowerCase();
      let topics = [...state.topics];
      if (state.topicFilter) topics = topics.filter((topic) => topic.tag === state.topicFilter);
      if (query) {
        topics = topics.filter((topic) => [topic.tag, topic.title, topic.description, topic.keywords].join(' ').toLowerCase().includes(query));
      }

      if (state.topicFilter && topics.length === 1) {
        const selected = topics[0];
        grid.classList.remove('grid-2');
        grid.classList.add('stack');
        grid.innerHTML = `
          <div class="topic-posts-head panel-card">
            <div class="row between wrap gap">
              <div>
                <h2>${escapeHtml(selected.title)}</h2>
                <p class="muted">${selected.count} post${selected.count === 1 ? '' : 's'} tagged with ${escapeHtml(selected.title)}.</p>
              </div>
              <button class="pill-btn ghost" type="button" id="clearTopicFilter">Show all topics</button>
            </div>
          </div>
          ${(selected.posts || []).map((post) => postCardMarkup(post)).join('') || '<div class="empty-state">No posts found for this topic.</div>'}
        `;
        qs('#clearTopicFilter', grid)?.addEventListener('click', () => {
          state.topicFilter = '';
          qsa('[data-topic]', topicChips).forEach((chip) => chip.classList.remove('active'));
          renderExplore();
        });
        attachReactionHandlers(grid);
        attachDeleteHandlers(grid);
        exploreEmpty.classList.add('hidden');
        return;
      }

      grid.classList.add('grid-2');
      grid.classList.remove('stack');
      grid.innerHTML = topics.map((topic) => `
        <article class="info-card">
          <div class="row between wrap gap">
            <h3>${escapeHtml(topic.title)}</h3>
            <span class="chip">${topic.count} posts</span>
          </div>
          <p class="muted">${escapeHtml(topic.description)}</p>
          <div class="row gap wrap">
            <button class="pill-btn solid" type="button" data-open-topic="${escapeHtml(topic.tag)}">View all posts</button>
            ${topic.samplePostId ? `<a class="pill-btn ghost" href="post.html?id=${encodeURIComponent(topic.samplePostId)}">Open latest post</a>` : ''}
          </div>
        </article>
      `).join('');
      qsa('[data-open-topic]', grid).forEach((btn) => btn.addEventListener('click', () => {
        state.topicFilter = btn.dataset.openTopic;
        qsa('[data-topic]', topicChips).forEach((chip) => chip.classList.toggle('active', chip.dataset.topic === state.topicFilter));
        renderExplore();
      }));
      exploreEmpty.classList.toggle('hidden', topics.length > 0);
    }
  }

  setNavState();
  updateHeaderAuth();

  switch (page) {
    case 'landing':
      initLanding();
      break;
    case 'signup':
      initSignup();
      break;
    case 'login':
      initLogin();
      break;
    case 'feed':
      initFeed();
      break;
    case 'create':
      initCreate();
      break;
    case 'post':
      initPost();
      break;
    case 'profile':
      initProfile();
      break;
    case 'explore':
      initExplore();
      break;
    default:
      break;
  }
})();