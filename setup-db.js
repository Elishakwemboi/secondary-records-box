const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dbPath = path.join(__dirname, "database.db");
const db = new sqlite3.Database(dbPath);

// Enable Foreign Key constraints
const createTablesSQL = `
  PRAGMA foreign_keys = ON;

-- 1. Schools Table
CREATE TABLE IF NOT EXISTS schools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    center_number TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users Table (School Admins & Teachers)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    admin_phone text,
    password_hash TEXT NOT NULL,
    role TEXT CHECK(role IN ('super_admin', 'school_admin', 'admin', 'teacher')) DEFAULT 'teacher',
    UNIQUE(school_id, email) -- Allows same email across different schools if needed
);

-- 3. Classes Table
CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    level TEXT NOT NULL,
    max_subjects INTEGER DEFAULT 10,
    class_teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Class Teachers Table (Supports Multiple Class Teachers)
CREATE TABLE IF NOT EXISTS class_teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(class_id, teacher_id)
);

-- 4. Subjects Table
CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    UNIQUE(school_id, code) -- Prevent duplicate subject codes within the same school
);

-- 5. Students Table
CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    lin TEXT, -- National Identification Number for learners
    gender TEXT NOT NULL,
    class_teacher_remark TEXT
);

-- 6. Teacher Allocations Table
CREATE TABLE IF NOT EXISTS teacher_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE
);

-- 7. Assessments Table (Now respects school_id)
CREATE TABLE IF NOT EXISTS assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
    subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
    term INTEGER NOT NULL,
    year INTEGER NOT NULL,
    assessment_type TEXT CHECK(assessment_type IN ('Formative', 'Summative')) NOT NULL,
    max_score REAL DEFAULT 3.0
);

-- 8. Attendance Table (Now respects school_id)
CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    status TEXT NOT NULL,
    UNIQUE(school_id, class_id, student_id, date)
);

CREATE TABLE IF NOT EXISTS marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    exam_type TEXT NOT NULL,
    term TEXT NOT NULL,
    score REAL NOT NULL,
    max_score REAL DEFAULT 100,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(school_id, student_id, subject_id, exam_type, term)
);

-- 10. Report Cards Table
CREATE TABLE IF NOT EXISTS report_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    school_id INTEGER NOT NULL,
    term INTEGER NOT NULL,
    year INTEGER NOT NULL,
    subjects TEXT,
    avg_percentage REAL DEFAULT 0,
    rank INTEGER DEFAULT NULL,
    class_teacher_comment TEXT DEFAULT 'Good progress overall.',
    head_teacher_comment TEXT DEFAULT 'Fair result. Aim higher next term.',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
    UNIQUE(student_id, term, year)
);

CREATE TABLE IF NOT EXISTS guest_planner_access (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_id TEXT UNIQUE NOT NULL, -- e.g., 'REC-PLAN-98231'
    phone_number TEXT NOT NULL,       -- e.g., '256770000000'
    network TEXT NOT NULL,            -- 'MTN' or 'AIRTEL'
    amount REAL NOT NULL,             -- e.g., 2000 UGX per plan
    status TEXT DEFAULT 'pending',    -- 'pending', 'completed', 'failed'
    doc_type TEXT NOT NULL,           -- 'lesson_plan' or 'scheme_of_work'
    generated_data TEXT,              -- JSON payload of generated document
    payment_tx_id TEXT,               -- Provider transaction reference
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- PERFORMANCE & ISOLATION INDEXES
CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id, class_id);
CREATE INDEX IF NOT EXISTS idx_assessments_school ON assessments(school_id);
CREATE INDEX IF NOT EXISTS idx_marks_school ON marks(school_id, student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_school ON attendance(school_id, date);
`;

db.serialize(() => {
    // Force foreign keys on connection runtime
    db.run("PRAGMA foreign_keys = ON;");

    // Split the script safely into individual table creation statements
    const statements = createTablesSQL
        .split(";")
        .map(sql => sql.trim())
        .filter(sql => sql.length > 0);

    // Execute each query one by one to add only what is missing
    statements.forEach((sql) => {
        db.run(sql, (err) => {
            if (err && !err.message.includes("already exists")) {
                console.error(`❌ Error running SQL statement:`, err.message);
            }
        });
    });

    db.serialize(() => {
        console.log("🔄 Database tables verification complete!");

        // Insert default test entries using plain text
        const defaultSchoolQuery = `INSERT OR IGNORE INTO schools (id, name, center_number) VALUES (1, 'Test Secondary School', 'TS001');`;
        const defaultUserQuery = `INSERT OR IGNORE INTO users (school_id, full_name, email, password_hash, role) 
                                  VALUES (1, 'Elisha Kwemboi', 'elishakwemboi9@gmail.com', 'password@123', 'super_admin');`;

        db.run(defaultSchoolQuery, (schoolErr) => {
            if (schoolErr) console.error("❌ Error seeding default school:", schoolErr.message);
            
            db.run(defaultUserQuery, (userErr) => {
                if (userErr) {
                    console.error("❌ Error seeding default super admin:", userErr.message);
                } else {
                    console.log("🚀 Default account 'elishakwemboi9@gmail.com' injected with plain-text password!");
                }
                db.close();
            });
        });
    });
});
