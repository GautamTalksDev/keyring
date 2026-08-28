import { runMigrations } from "./migrate.js";

await runMigrations();
console.log("Migrations applied.");
