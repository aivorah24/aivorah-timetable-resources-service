# Aivorah Timetable & Resources Service

Standalone microservice for the class **Timetable** (weekly bell schedule per
grade + section) and the school **Resources** library (folders, PDFs and
pictures). Used by every persona: student, teacher, parent, school admin.

Replaces `/timetable` in aivorah-schedule-service and `/resources` in
aivorah-school-admin-service. Same tables (`class_timetables`,
`timetable_slots`, `resource_folders`, `resource_files`), so no data moves.

## Sign-in

Every route except `/health` needs `Authorization: Bearer <Firebase ID token>`.
The user's role, school, grade and section are loaded from `users` by the
token's email; nothing about identity or school is read from the request.

## Routes

| Route | Who |
|---|---|
| `GET /timetable/classes` | anyone; classes they can open (+ grades for admins) |
| `GET /timetable?grade=&section=` | students of the class, parents of a child in it, teachers/admins of the school |
| `GET /timetable/mine` | teachers; their own week — every period they teach in any class of the school, one grid, each period with the class to go to (+ `clashes` for double-booked periods) |
| `GET /timetable/teachers` | teachers, school admins; the school's teachers (to choose who takes a period) |
| `PUT /timetable/template` | school admin, or the class's homeroom teacher |
| `PUT /timetable/slot` | template managers, or any teacher in the school; `teacherId` (who takes the period) only template managers |
| `POST /timetable/import/preview` (multipart `file`, PDF ≤ 10 MB) | school admins, teachers — reads every class timetable in the PDF and matches it to the school's classes; saves nothing |
| `POST /timetable/import/commit` | school admin (any class) or homeroom teacher (own class) — replaces those classes' periods and subjects |
| `GET /resources?folderId=` | anyone in the school (students/parents see school + their grade/curriculum scope) |
| `POST /resources/folder`, `POST /resources/file` | teachers, school admins |
| `DELETE /resources/folder/:id`, `DELETE /resources/file/:id` | teachers, school admins |
| `POST /uploads` (multipart `file`, PDF/image, ≤ 25 MB) | teachers, school admins |

## Structure

```
index.js                 app, /health, routes behind middleware/auth.js
middleware/auth.js       Firebase token → req.user
routes/                  timetable.js, resources.js, uploads.js
services/classAccess.js  who may view / edit (pure functions)
services/*Store.js       Supabase queries
services/academicStructure.js  a school's grades and sections
services/storage.js      Cloudinary upload
services/timetableImport/  PDF → Gemini / Groq / OpenRouter → clean periods/slots, class + teacher matching
```

## Run

```
cp .env.example .env   # fill in
npm install
npm run dev            # http://localhost:3021
npm test
```

Environment: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
`FIREBASE_SERVICE_ACCOUNT_B64`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
`CLOUDINARY_API_SECRET`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` (timetable PDF import, tried in that order; Groq/OpenRouter get page images. Optional `GEMINI_MODELS`, `GROQ_VISION_MODELS`, `OPENROUTER_VISION_MODELS`, `IMPORT_AI_TIMEOUT_MS`).
