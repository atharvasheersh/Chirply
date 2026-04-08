require('dotenv').config();

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { put } = require('@vercel/blob');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOCAL_UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const IS_VERCEL = Boolean(process.env.VERCEL);
const USE_BLOB_STORAGE = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const MAX_UPLOAD_BYTES = USE_BLOB_STORAGE ? Math.floor(4.5 * 1024 * 1024) : 10 * 1024 * 1024;
const REACTION_TYPES = ['smile', 'heart', 'laugh'];
const DB_NAME = process.env.DB_NAME || 'chirply';
const MONGODB_URI = normalizeMongoUri(process.env.MONGODB_URI);

fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!USE_BLOB_STORAGE) {
  fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
}

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

if (!IS_VERCEL) {
  app.use(express.static(PUBLIC_DIR));
}

app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

['index', 'feed', 'create', 'explore', 'login', 'signup', 'post', 'profile'].forEach((pageName) => {
  app.get(`/${pageName}`, (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, `${pageName}.html`));
  });
  app.get(`/${pageName}.html`, (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, `${pageName}.html`));
  });
});

const storage = USE_BLOB_STORAGE
    ? multer.memoryStorage()
    : multer.diskStorage({
      destination: function (_req, _file, cb) {
        cb(null, LOCAL_UPLOAD_DIR);
      },
      filename: function (_req, file, cb) {
        cb(null, `${Date.now()}-${safeFileName(file.originalname)}`);
      }
    });

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: function (_req, file, cb) {
    const ok = /^(image\/(jpeg|png|webp)|video\/(mp4|webm))$/.test(file.mimetype);
    if (!ok) return cb(new Error('Only JPG, PNG, WEBP, MP4, and WEBM files are allowed.'));
    cb(null, true);
  }
});

let cachedDb = null;
let cachedClientPromise = null;
let initPromise = null;

function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function safeFileName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function normalizeMongoUri(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  return value
      .replace(/^MONGODB_URI\s*=\s*/i, '')
      .replace(/^['"]|['"]$/g, '');
}

function nextId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function words(str) {
  const trimmed = String(str || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function avatarText(name, username) {
  if (name) {
    const initials = String(name)
        .split(' ')
        .map((s) => s[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();
    if (initials) return initials;
  }
  return String(username || 'U').replace('@', '').slice(0, 2).toUpperCase();
}

function formatDateTime(iso) {
  return new Date(iso).toISOString();
}

function normalizedTags(tags) {
  return (Array.isArray(tags) ? tags : [])
      .map((tag) => String(tag || '').trim().toLowerCase())
      .filter(Boolean)
      .sort();
}

function postFingerprint(post) {
  const media = post && post.media ? post.media : null;
  const mediaSignature = media
      ? [media.type || '', media.originalName || '', media.poster || ''].join('|').toLowerCase()
      : '';

  return JSON.stringify({
    userId: String(post?.userId || ''),
    title: String(post?.title || '').trim().toLowerCase(),
    content: String(post?.content || '').trim().toLowerCase(),
    tags: normalizedTags(post?.tags),
    media: mediaSignature
  });
}

function dedupePosts(posts) {
  const seen = new Set();
  const unique = [];

  for (const post of posts || []) {
    const fingerprint = postFingerprint(post);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    unique.push(post);
  }

  return unique;
}

function getReactionCounts(post) {
  const reactions = post.reactions || { smile: [], heart: [], laugh: [] };
  return {
    smile: (reactions.smile || []).length,
    heart: (reactions.heart || []).length,
    laugh: (reactions.laugh || []).length,
    total: (reactions.smile || []).length + (reactions.heart || []).length + (reactions.laugh || []).length
  };
}

async function getDb() {
  if (cachedDb) return cachedDb;
  if (!MONGODB_URI) {
    throw new Error('Missing MONGODB_URI. Add it to .env for local development and in Vercel Environment Variables for deployment.');
  }

  if (!cachedClientPromise) {
    const client = new MongoClient(MONGODB_URI);
    cachedClientPromise = client.connect();
  }

  const client = await cachedClientPromise;
  cachedDb = client.db(DB_NAME);
  return cachedDb;
}

async function initializeDb() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const db = await getDb();
    await Promise.all([
      db.collection('users').createIndex({ email: 1 }, { unique: true }),
      db.collection('users').createIndex({ usernameLower: 1 }, { unique: true }),
      db.collection('users').createIndex({ id: 1 }, { unique: true }),
      db.collection('posts').createIndex({ id: 1 }, { unique: true }),
      db.collection('posts').createIndex({ title: 1 }),
      db.collection('posts').createIndex({ createdAt: -1 }),
      db.collection('drafts').createIndex({ id: 1 }, { unique: true }),
      db.collection('drafts').createIndex({ userId: 1 }, { unique: true })
    ]);

    const users = db.collection('users');
    const posts = db.collection('posts');

    const ensureUser = async ({ email, name, username, password, bio }) => {
      const normalizedEmail = String(email).toLowerCase();
      const usernameLower = String(username).toLowerCase();
      let existing = await users.findOne({
        $or: [
          { email: normalizedEmail },
          { usernameLower }
        ]
      });
      if (existing) {
        await users.updateOne({ id: existing.id }, {
          $set: {
            name,
            email: normalizedEmail,
            username,
            usernameLower,
            password,
            bio
          }
        });
        return users.findOne({ id: existing.id });
      }

      const user = {
        id: nextId('user'),
        name,
        email: normalizedEmail,
        username,
        usernameLower,
        password,
        bio,
        createdAt: new Date().toISOString()
      };
      await users.insertOne(user);
      return user;
    };

    const legacyDemoUser = await users.findOne({
      $or: [
        { email: 'atharva.demo@gmail.com' },
        { email: 'webproject@chirply.demo' },
        { usernameLower: '@atharva_demo' },
        { usernameLower: '@webproject' }
      ]
    });

    let demoUser;
    if (legacyDemoUser) {
      await users.updateOne({ id: legacyDemoUser.id }, {
        $set: {
          name: 'WebProject',
          email: 'webproject@chirply.demo',
          username: '@WebProject',
          usernameLower: '@webproject',
          password: 'PRP232',
          bio: 'Demo account for the Chirply web project.'
        }
      });
      demoUser = await users.findOne({ id: legacyDemoUser.id });
    } else {
      demoUser = await ensureUser({
        email: 'webproject@chirply.demo',
        name: 'WebProject',
        username: '@WebProject',
        password: 'PRP232',
        bio: 'Demo account for the Chirply web project.'
      });
    }

    const nishaUser = await ensureUser({
      email: 'nisha.writer@chirply.demo',
      name: 'Nisha Verma',
      username: '@nisha_notes',
      password: 'demo123',
      bio: 'Notes, reflections, and quiet observations.'
    });

    const saraUser = await ensureUser({
      email: 'sara.care@chirply.demo',
      name: 'Sara Thomas',
      username: '@sara_cares',
      password: 'demo123',
      bio: 'Rescue stories, dogs, and small everyday hope.'
    });

    const seedPosts = [
      {
        userId: nishaUser.id,
        title: 'The Pressure of Studying Alone',
        tags: ['study', 'students', 'reflection'],
        content: `Studying alone gives you control. You choose when to study, how to study, and how long to sit with a book. No one interrupts you. No one tells you that your method is wrong.

But studying alone also means—no new ideas, no fresh perspectives, no shared motivation.

During my first two attempts, I spent too much time overthinking. I believed I could figure it all out on my own. I had my plan, my schedule, my way of studying.

But sometimes, our ways hold us back.`,
        media: {
          type: 'image',
          url: '/assets/media/nisha-notes.png',
          originalName: 'nisha-notes.png'
        },
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
        reactions: { smile: [demoUser.id], heart: [demoUser.id], laugh: [] },
        comments: [
          {
            id: nextId('comment'),
            userId: demoUser.id,
            text: 'This feels very real. Studying with the wrong strategy can be more isolating than the syllabus itself.',
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString()
          }
        ]
      },
      {
        userId: saraUser.id,
        title: 'Dog Blog',
        tags: ['dogs', 'rescue', 'care'],
        content: `I know scientifically they say dogs don’t smile but you do have to look at Anthony in this picture below and wonder. On the left was when we brought him in from the streets and on the right returning from a walk this week with his friends about to be served his dinner and have a comfy nights sleep.

These street dogs had nothing but pain and a sad end ahead of them. Some had cancer. Bridget fell off a bridge and a few of them are nearly blind. Now they know nothing but love and care. From the vets who treat them, the people who donated, their walkers and the ladies who prepare their food, it is humans who have done this.`,
        media: {
          type: 'video',
          url: '/assets/media/sara-dog.mp4',
          originalName: 'sara-dog.mp4',
          poster: '/assets/media/sara-dog-poster.jpg'
        },
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
        reactions: { smile: [demoUser.id, nishaUser.id], heart: [demoUser.id], laugh: [] },
        comments: [
          {
            id: nextId('comment'),
            userId: demoUser.id,
            text: 'Anthony absolutely looks like he knows he is loved now.',
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString()
          }
        ]
      },
      {
        userId: demoUser.id,
        title: 'Welcome to Chirply',
        tags: ['chirply', 'demo', 'students'],
        content: 'Chirply is a short-form content platform where users can publish concise posts, react using smile, heart, and laugh, add comments, save drafts, and explore topic-based content in a clean interface.',
        media: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 50).toISOString(),
        reactions: { smile: [], heart: [], laugh: [] },
        comments: []
      }
    ];

    for (const seed of seedPosts) {
      const existing = await posts.findOne({ title: seed.title });
      if (existing) {
        await posts.updateOne({ id: existing.id }, { $set: seed });
      } else {
        await posts.insertOne({ id: nextId('post'), ...seed });
      }
    }
  })();

  return initPromise;
}

async function getUserById(db, userId) {
  return db.collection('users').findOne({ id: userId }, { projection: { _id: 0 } });
}

async function getUserMap(db) {
  const users = await db.collection('users').find({}, { projection: { _id: 0, password: 0, usernameLower: 0 } }).toArray();
  return new Map(users.map((user) => [user.id, user]));
}

function hydratePostSummary(userMap, post, currentUserId) {
  const author = userMap.get(post.userId) || { id: null, name: 'Unknown', username: '@unknown' };
  const counts = getReactionCounts(post);
  const reactions = post.reactions || { smile: [], heart: [], laugh: [] };

  return {
    id: post.id,
    title: post.title,
    content: post.content,
    excerpt: post.content.length > 160 ? `${post.content.slice(0, 160)}...` : post.content,
    tags: Array.isArray(post.tags) ? post.tags : [],
    createdAt: formatDateTime(post.createdAt),
    readTime: Math.max(1, Math.ceil(words(post.content) / 200)),
    author: {
      id: author.id,
      name: author.name,
      username: author.username,
      avatar: avatarText(author.name, author.username)
    },
    media: post.media || null,
    reactionCounts: counts,
    userReactions: {
      smile: Boolean(currentUserId && (reactions.smile || []).includes(currentUserId)),
      heart: Boolean(currentUserId && (reactions.heart || []).includes(currentUserId)),
      laugh: Boolean(currentUserId && (reactions.laugh || []).includes(currentUserId))
    },
    commentCount: Array.isArray(post.comments) ? post.comments.length : 0,
    canDelete: Boolean(currentUserId && post.userId === currentUserId)
  };
}

function hydratePostDetail(userMap, post, allPosts, currentUserId) {
  const summary = hydratePostSummary(userMap, post, currentUserId);
  const comments = (post.comments || [])
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((comment) => {
        const user = userMap.get(comment.userId) || { id: null, name: 'Unknown', username: '@unknown' };
        return {
          id: comment.id,
          text: comment.text,
          createdAt: formatDateTime(comment.createdAt),
          user: {
            id: user.id,
            name: user.name,
            username: user.username,
            avatar: avatarText(user.name, user.username)
          }
        };
      });

  const related = allPosts
      .filter((candidate) => candidate.id !== post.id)
      .map((candidate) => ({
        post: candidate,
        overlap: (candidate.tags || []).filter((tag) => (post.tags || []).includes(tag)).length
      }))
      .sort((a, b) => b.overlap - a.overlap || new Date(b.post.createdAt) - new Date(a.post.createdAt))
      .slice(0, 3)
      .map(({ post: candidate }) => hydratePostSummary(userMap, candidate, currentUserId));

  return { ...summary, comments, related };
}

async function ensureUser(req, res) {
  const userId = req.body.userId || req.query.userId || req.headers['x-user-id'];
  if (!userId) {
    res.status(401).json({ error: 'Login required.' });
    return null;
  }

  const db = await getDb();
  const user = await getUserById(db, userId);
  if (!user) {
    res.status(401).json({ error: 'Invalid user session.' });
    return null;
  }

  return { db, user };
}

async function uploadMedia(file) {
  if (!file) return null;

  if (USE_BLOB_STORAGE) {
    const pathname = `chirply/${Date.now()}-${safeFileName(file.originalname)}`;
    const blob = await put(pathname, new Blob([file.buffer], { type: file.mimetype }), {
      access: 'public',
      addRandomSuffix: true,
      contentType: file.mimetype
    });

    return {
      type: file.mimetype.startsWith('image/') ? 'image' : 'video',
      url: blob.url,
      originalName: file.originalname
    };
  }

  return {
    type: file.mimetype.startsWith('image/') ? 'image' : 'video',
    url: `/uploads/${file.filename}`,
    originalName: file.originalname
  };
}

app.get('/api/health', asyncHandler(async (_req, res) => {
  await initializeDb();
  res.json({ ok: true, storage: USE_BLOB_STORAGE ? 'vercel-blob' : 'local-uploads', database: DB_NAME });
}));

app.get('/api/landing', asyncHandler(async (req, res) => {
  await initializeDb();
  const db = await getDb();
  const userMap = await getUserMap(db);
  const posts = await db.collection('posts').find({}).sort({ createdAt: -1 }).toArray();
  const featured = posts[0] ? hydratePostSummary(userMap, posts[0], req.query.userId) : null;
  res.json({ featured });
}));

app.post('/api/auth/signup', asyncHandler(async (req, res) => {
  await initializeDb();
  const { name = '', email = '', username = '', password = '' } = req.body;
  const db = await getDb();

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedUsername = String(username).trim().startsWith('@')
      ? String(username).trim()
      : `@${String(username).trim()}`;
  const usernameLower = normalizedUsername.toLowerCase();

  if (!String(name).trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!normalizedEmail) return res.status(400).json({ error: 'Email is required.' });
  if (!normalizedUsername || normalizedUsername === '@') return res.status(400).json({ error: 'Username is required.' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const existingEmail = await db.collection('users').findOne({ email: normalizedEmail });
  if (existingEmail) return res.status(400).json({ error: 'Email already registered.' });

  const existingUsername = await db.collection('users').findOne({ usernameLower });
  if (existingUsername) return res.status(400).json({ error: 'Username already taken.' });

  const user = {
    id: nextId('user'),
    name: String(name).trim(),
    email: normalizedEmail,
    username: normalizedUsername,
    usernameLower,
    password: String(password),
    bio: 'Student Developer • Chirply Creator',
    createdAt: new Date().toISOString()
  };

  await db.collection('users').insertOne(user);
  res.json({
    message: 'Account created successfully.',
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      avatar: avatarText(user.name, user.username)
    }
  });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  await initializeDb();
  const { email = '', identifier = '', password = '' } = req.body;
  const db = await getDb();
  const rawIdentifier = String(identifier || email).trim();
  const normalizedIdentifier = rawIdentifier.toLowerCase();
  const normalizedUsername = normalizedIdentifier.startsWith('@')
      ? normalizedIdentifier
      : `@${normalizedIdentifier}`;

  const user = await db.collection('users').findOne({
    password: String(password),
    $or: [
      { email: normalizedIdentifier },
      { usernameLower: normalizedUsername }
    ]
  }, {
    projection: { _id: 0, usernameLower: 0 }
  });

  if (!user) return res.status(401).json({ error: 'Invalid username/email or password.' });
  res.json({
    message: 'Login successful.',
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      avatar: avatarText(user.name, user.username)
    }
  });
}));

app.get('/api/posts', asyncHandler(async (req, res) => {
  await initializeDb();
  const db = await getDb();
  const currentUserId = req.query.userId;
  const userMap = await getUserMap(db);
  const rawPosts = dedupePosts(await db.collection('posts').find({}).sort({ createdAt: -1 }).toArray());
  const posts = rawPosts.map((post) => hydratePostSummary(userMap, post, currentUserId));

  const tagCounts = {};
  posts.forEach((post) => {
    (post.tags || []).forEach((tag) => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });

  const trendingTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tag, count]) => ({ tag, count }));

  res.json({ posts, trendingTags });
}));

app.get('/api/posts/:id', asyncHandler(async (req, res) => {
  await initializeDb();
  const db = await getDb();
  const post = await db.collection('posts').findOne({ id: req.params.id });
  if (!post) return res.status(404).json({ error: 'Post not found.' });

  const userMap = await getUserMap(db);
  const allPosts = dedupePosts(await db.collection('posts').find({}).sort({ createdAt: -1 }).toArray());
  res.json(hydratePostDetail(userMap, post, allPosts, req.query.userId));
}));

app.post('/api/posts', upload.single('media'), asyncHandler(async (req, res) => {
  await initializeDb();
  const ensured = await ensureUser(req, res);
  if (!ensured) return;
  const { db, user } = ensured;
  const { title = '', tags = '', content = '' } = req.body;
  const normalizedTitle = String(title).trim();
  const normalizedContent = String(content).trim();
  const normalizedPostTags = String(tags)
      .split(',')
      .map((value) => value.trim().replace(/^#/, '').toLowerCase())
      .filter(Boolean);

  if (!normalizedTitle) return res.status(400).json({ error: 'Title is required.' });
  if (!normalizedContent) return res.status(400).json({ error: 'Content cannot be empty.' });
  if (words(normalizedContent) > 1000) return res.status(400).json({ error: 'Content exceeds 1000 words.' });

  const duplicateCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recentPosts = await db.collection('posts').find({
    userId: user.id,
    title: normalizedTitle,
    content: normalizedContent,
    createdAt: { $gte: duplicateCutoff }
  }).sort({ createdAt: -1 }).toArray();

  const duplicatePost = recentPosts.find((existing) => JSON.stringify(normalizedTags(existing.tags)) === JSON.stringify(normalizedTags(normalizedPostTags)));
  if (duplicatePost) {
    const userMap = await getUserMap(db);
    return res.json({
      message: 'This post was already published a moment ago.',
      post: hydratePostSummary(userMap, duplicatePost, user.id)
    });
  }

  const media = await uploadMedia(req.file);
  const post = {
    id: nextId('post'),
    userId: user.id,
    title: normalizedTitle,
    tags: normalizedPostTags,
    content: normalizedContent,
    media,
    createdAt: new Date().toISOString(),
    reactions: { smile: [], heart: [], laugh: [] },
    comments: []
  };

  await db.collection('posts').insertOne(post);
  await db.collection('drafts').deleteOne({ userId: user.id });

  const userMap = await getUserMap(db);
  res.json({ message: 'Post published successfully.', post: hydratePostSummary(userMap, post, user.id) });
}));

app.post('/api/posts/:id/react', asyncHandler(async (req, res) => {
  await initializeDb();
  const ensured = await ensureUser(req, res);
  if (!ensured) return;
  const { db, user } = ensured;
  const { reaction } = req.body;

  if (!REACTION_TYPES.includes(reaction)) {
    return res.status(400).json({ error: 'Invalid reaction.' });
  }

  const post = await db.collection('posts').findOne({ id: req.params.id });
  if (!post) return res.status(404).json({ error: 'Post not found.' });

  const reactions = post.reactions || { smile: [], heart: [], laugh: [] };
  const wasActive = (reactions[reaction] || []).includes(user.id);

  REACTION_TYPES.forEach((type) => {
    reactions[type] = (reactions[type] || []).filter((id) => id !== user.id);
  });

  if (!wasActive) {
    reactions[reaction].push(user.id);
  }

  await db.collection('posts').updateOne({ id: post.id }, { $set: { reactions } });
  const updatedPost = { ...post, reactions };

  res.json({
    reactionCounts: getReactionCounts(updatedPost),
    userReactions: {
      smile: reactions.smile.includes(user.id),
      heart: reactions.heart.includes(user.id),
      laugh: reactions.laugh.includes(user.id)
    }
  });
}));

app.post('/api/posts/:id/comments', asyncHandler(async (req, res) => {
  await initializeDb();
  const ensured = await ensureUser(req, res);
  if (!ensured) return;
  const { db, user } = ensured;
  const { text = '' } = req.body;

  if (!String(text).trim()) return res.status(400).json({ error: 'Comment cannot be empty.' });
  const post = await db.collection('posts').findOne({ id: req.params.id });
  if (!post) return res.status(404).json({ error: 'Post not found.' });

  const comment = {
    id: nextId('comment'),
    userId: user.id,
    text: String(text).trim(),
    createdAt: new Date().toISOString()
  };

  await db.collection('posts').updateOne({ id: post.id }, { $push: { comments: { $each: [comment], $position: 0 } } });
  res.json({
    message: 'Comment added.',
    comment: {
      id: comment.id,
      text: comment.text,
      createdAt: comment.createdAt,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        avatar: avatarText(user.name, user.username)
      }
    }
  });
}));

app.delete('/api/posts/:id', asyncHandler(async (req, res) => {
  await initializeDb();
  const ensured = await ensureUser(req, res);
  if (!ensured) return;
  const { db, user } = ensured;

  const post = await db.collection('posts').findOne({ id: req.params.id });
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  if (post.userId !== user.id) {
    return res.status(403).json({ error: 'You can delete only your own posts.' });
  }

  await db.collection('posts').deleteOne({ id: post.id });
  res.json({ success: true, message: 'Post deleted successfully.' });
}));

app.get('/api/drafts/me', asyncHandler(async (req, res) => {
  await initializeDb();
  const ensured = await ensureUser(req, res);
  if (!ensured) return;
  const { db, user } = ensured;
  const draft = await db.collection('drafts').findOne({ userId: user.id }, { projection: { _id: 0 } });
  res.json({ draft: draft || null });
}));

app.post('/api/drafts/me', asyncHandler(async (req, res) => {
  await initializeDb();
  const ensured = await ensureUser(req, res);
  if (!ensured) return;
  const { db, user } = ensured;
  const { title = '', tags = '', content = '', mediaName = '', mediaType = '' } = req.body;

  const draft = {
    id: nextId('draft'),
    userId: user.id,
    title: String(title),
    tags: String(tags),
    content: String(content),
    mediaName: String(mediaName),
    mediaType: String(mediaType),
    updatedAt: new Date().toISOString()
  };

  await db.collection('drafts').updateOne(
      { userId: user.id },
      { $set: draft },
      { upsert: true }
  );

  res.json({ message: 'Draft saved.', draft });
}));

app.get('/api/users/me/profile', asyncHandler(async (req, res) => {
  await initializeDb();
  const ensured = await ensureUser(req, res);
  if (!ensured) return;
  const { db, user } = ensured;
  const userMap = await getUserMap(db);
  const allPosts = dedupePosts(await db.collection('posts').find({}).sort({ createdAt: -1 }).toArray());

  const publishedRaw = dedupePosts(allPosts.filter((post) => post.userId === user.id));
  const published = publishedRaw.map((post) => hydratePostSummary(userMap, post, user.id));
  const likedRaw = dedupePosts(allPosts.filter((post) =>
      post.userId !== user.id && REACTION_TYPES.some((type) => (post.reactions?.[type] || []).includes(user.id))
  ));
  const liked = likedRaw.map((post) => hydratePostSummary(userMap, post, user.id));
  const draft = await db.collection('drafts').findOne({ userId: user.id }, { projection: { _id: 0 } });
  const totalReactions = published.reduce((sum, post) => sum + post.reactionCounts.total, 0);

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      bio: user.bio,
      avatar: avatarText(user.name, user.username)
    },
    stats: {
      posts: published.length,
      totalReactions,
      drafts: draft ? 1 : 0
    },
    published,
    drafts: draft ? [draft] : [],
    liked
  });
}));

app.get('/api/explore', asyncHandler(async (req, res) => {
  await initializeDb();
  const db = await getDb();
  const currentUserId = req.query.userId;
  const userMap = await getUserMap(db);
  const posts = dedupePosts(await db.collection('posts').find({}).sort({ createdAt: -1 }).toArray());
  const tagMap = new Map();

  posts.forEach((post) => {
    (post.tags || []).forEach((tag) => {
      const entry = tagMap.get(tag) || { tag, count: 0, posts: [] };
      entry.count += 1;
      entry.posts.push(post);
      tagMap.set(tag, entry);
    });
  });

  const topics = Array.from(tagMap.values())
      .sort((a, b) => b.count - a.count)
      .map((entry) => {
        const latest = entry.posts.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
        return {
          tag: entry.tag,
          count: entry.count,
          title: `#${entry.tag}`,
          description: latest
              ? (latest.content.length > 120 ? `${latest.content.slice(0, 120)}...` : latest.content)
              : 'Browse posts on this topic.',
          samplePostId: latest ? latest.id : null,
          keywords: entry.posts.flatMap((post) => [post.title, ...(post.tags || [])]).join(' '),
          posts: entry.posts
              .slice()
              .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
              .map((post) => hydratePostSummary(userMap, post, currentUserId))
        };
      });

  res.json({ topics: topics.slice(0, 12), trending: topics.slice(0, 5) });
}));

app.use((err, _req, res, _next) => {
  console.error(err);

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const limitText = USE_BLOB_STORAGE ? '4.5 MB on Vercel server uploads' : '10 MB locally';
      return res.status(400).json({ error: `File is too large. Maximum allowed is ${limitText}.` });
    }
    return res.status(400).json({ error: err.message || 'Upload failed.' });
  }

  const message = err && err.message ? err.message : 'Something went wrong.';
  res.status(500).json({ error: message });
});

if (!IS_VERCEL) {
  app.listen(PORT, async () => {
    try {
      await initializeDb();
      console.log(`Chirply running on http://localhost:${PORT}`);
      console.log(`Media storage: ${USE_BLOB_STORAGE ? 'Vercel Blob' : 'Local uploads (/public/uploads)'}`);
    } catch (error) {
      console.error('Startup error:', error.message);
    }
  });
}

module.exports = app;