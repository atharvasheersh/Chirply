# Chirply — Vercel + MongoDB Atlas + Vercel Blob

This version of Chirply is prepared for:
- **Hosting:** Vercel Hobby
- **Backend:** Node.js + Express
- **Database:** MongoDB Atlas Free
- **Media uploads:** Vercel Blob on deployment, local `/public/uploads` in local development when no Blob token is present
- **API testing:** Postman

## Important note about your frontend assets
The uploaded project files included the HTML pages, `server.js`, and package files, but **did not include**:
- `assets/styles.css`
- `assets/app.js`

Your HTML files still reference those files, so before running this package you should copy your existing frontend assets into:

```text
public/assets/styles.css
public/assets/app.js
```

## Project structure

```text
chirply-vercel/
├─ public/
│  ├─ index.html
│  ├─ feed.html
│  ├─ create.html
│  ├─ explore.html
│  ├─ login.html
│  ├─ signup.html
│  ├─ post.html
│  ├─ profile.html
│  ├─ uploads/
│  └─ assets/
├─ .env.example
├─ package.json
├─ server.js
└─ vercel.json
```

## 1) Local setup

### Install Node.js
Install **Node.js 20 or newer**.

### Install dependencies
Open a terminal inside this folder and run:

```bash
npm install
```

### Create your environment file
Copy `.env.example` to `.env` and fill in your real values.

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

On macOS/Linux:

```bash
cp .env.example .env
```

### Get MongoDB Atlas working
1. Create a free MongoDB Atlas account
2. Create a **Free** cluster
3. Create a database user with a password
4. In **Network Access**, allow your IP address
5. Click **Connect** → **Drivers**
6. Copy the connection string into `MONGODB_URI`
7. Keep `DB_NAME=chirply`

### Run locally

```bash
npm start
```

Open:

```text
http://localhost:3000
```

### Local media behavior
- If `BLOB_READ_WRITE_TOKEN` is **not** set, uploads are stored locally in `public/uploads`
- If `BLOB_READ_WRITE_TOKEN` **is** set, uploads go to Vercel Blob even during local development

## 2) Vercel deployment — easiest path

### A. Put the project on GitHub
1. Create a GitHub repository
2. Upload this project to that repository

### B. Import into Vercel
1. Sign in to Vercel
2. Click **Add New Project**
3. Import your GitHub repository
4. Vercel should detect it automatically
5. Leave the framework as detected/default for an Express app
6. Click **Deploy** once to create the project

### C. Add MongoDB Atlas environment variables in Vercel
In your Vercel project:
1. Open **Settings**
2. Open **Environment Variables**
3. Add:
   - `MONGODB_URI`
   - `DB_NAME` with value `chirply`

Then redeploy.

### D. Add Vercel Blob
1. Open your Vercel project
2. Go to **Storage**
3. Choose **Blob**
4. Create a **public** Blob store
5. Vercel will automatically add `BLOB_READ_WRITE_TOKEN`
6. Redeploy the project

Once this is done, uploaded images/videos will be stored in Vercel Blob.

## 3) Deploy using the Vercel CLI
If you prefer the terminal:

```bash
npm i -g vercel
vercel
```

For production:

```bash
vercel --prod
```

To pull your Vercel environment variables into local development later:

```bash
vercel env pull
```

To run the Vercel-like environment locally:

```bash
npm run dev
```

## 4) Demo login
The server seeds a demo user automatically if the database is empty:

- **Email:** `atharva.demo@gmail.com`
- **Password:** `demo123`

It also seeds one welcome post the first time the database starts.

## 5) API routes for Postman

### Health
- `GET /api/health`

### Auth
- `POST /api/auth/signup`
- `POST /api/auth/login`

### Posts
- `GET /api/posts`
- `GET /api/posts/:id`
- `POST /api/posts`
- `POST /api/posts/:id/react`
- `POST /api/posts/:id/comments`

### Drafts
- `GET /api/drafts/me`
- `POST /api/drafts/me`

### Profile / Explore
- `GET /api/users/me/profile`
- `GET /api/explore`

## 6) Postman examples

### Login
**POST** `/api/auth/login`

Body → raw JSON:

```json
{
  "email": "atharva.demo@gmail.com",
  "password": "demo123"
}
```

Use the returned `user.id` as `x-user-id` for protected routes.

### Create post without media
**POST** `/api/posts`

Headers:

```text
x-user-id: <your-user-id>
```

Body → form-data:
- `title`: My first Chirply post
- `tags`: demo,students,webdev
- `content`: Hello from Chirply

### Create post with media
**POST** `/api/posts`

Headers:

```text
x-user-id: <your-user-id>
```

Body → form-data:
- `title`: My first media post
- `tags`: demo,media
- `content`: This post includes media
- `media`: choose a JPG/PNG/WEBP/MP4/WEBM file

## 7) Upload limits
- **Local mode:** 10 MB
- **Vercel server uploads:** 4.5 MB

If you later want bigger uploads on Vercel, move to a client-upload flow with Vercel Blob.

## 8) Common beginner mistakes
- Forgetting to add `MONGODB_URI`
- Forgetting to allow your IP in MongoDB Atlas Network Access
- Forgetting to copy `assets/styles.css` and `assets/app.js` into `public/assets`
- Expecting root-level HTML files to work on Vercel without moving them into `public/`
- Trying to upload a file larger than the allowed limit
