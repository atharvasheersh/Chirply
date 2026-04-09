# Chirply — Vercel + MongoDB Atlas + Vercel Blob

Chirply is a short-form content platform built with a simple multi-page frontend and a lightweight Node.js + Express backend.

## Stack
- **Hosting:** Vercel Hobby
- **Backend:** Node.js + Express
- **Database:** MongoDB Atlas
- **Media uploads:** Vercel Blob
- **Frontend:** HTML, CSS, JavaScript

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

## Local setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create your environment file
Copy `.env.example` to `.env`.

**Windows PowerShell**
```powershell
Copy-Item .env.example .env
```

**macOS/Linux**
```bash
cp .env.example .env
```

### 3. Add your environment variables
Fill in:
- `MONGODB_URI`
- `DB_NAME=chirply`
- `BLOB_READ_WRITE_TOKEN` if needed

### 4. Run the project
```bash
npm start
```

Open:
```text
http://localhost:3000
```

## MongoDB setup
1. Create a MongoDB Atlas account
2. Create a free cluster
3. Create a database user
4. Allow your IP in **Network Access**
5. Copy the connection string from **Connect → Drivers**
6. Add it to `MONGODB_URI`

## Vercel deployment
1. Push the project to GitHub
2. Import the repository into Vercel
3. Add these environment variables in Vercel:
   - `MONGODB_URI`
   - `DB_NAME`
   - `BLOB_READ_WRITE_TOKEN`
4. Redeploy the project

## Media uploads
- In local development, uploads can be stored locally
- In deployment, uploads use Vercel Blob

## Demo login
If seeded in the database:

- **Email:** `atharva.demo@gmail.com`
- **Password:** `demo123`

## Notes
- Keep all frontend files inside `public/`
- Make sure your MongoDB URI is added correctly in Vercel
- If media uploads are not working in deployment, check `BLOB_READ_WRITE_TOKEN`
