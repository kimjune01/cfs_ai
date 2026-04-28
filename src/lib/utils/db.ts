import Database from "better-sqlite3";
import { join } from "path";

const DB_PATH = join(process.cwd(), "data", "cfs.db");

let _db: Database.Database | null = null;

const getDb = (): Database.Database => {
    if (!_db) {
        _db = new Database(DB_PATH, { readonly: true });
    }
    return _db;
};

export { getDb };
