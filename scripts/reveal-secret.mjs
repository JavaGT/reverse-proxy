import dotenv from "dotenv";
import fs from "node:fs";

dotenv.config();

/**
 * CLI utility to reveal the management secret key.
 * Reads the file path from MANAGEMENT_SECRET_FILE in .env.
 */
function main() {
    const filePath = process.env.MANAGEMENT_SECRET_FILE;

    if (!filePath) {
        console.error("Error: MANAGEMENT_SECRET_FILE is not defined in .env");
        process.exit(1);
    }

    if (!fs.existsSync(filePath)) {
        console.error(`Error: Secret file ${filePath} does not exist. Use npm run secret:rotate to create it.`);
        process.exit(1);
    }

    try {
        const secret = fs.readFileSync(filePath, "utf8").trim();
        console.log(`\n🔑 Dashboard Management Secret:`);
        console.log(`----------------------------------------------------------------`);
        console.log(secret);
        console.log(`----------------------------------------------------------------`);
        console.log(`\nCopy and paste this into the "Management Secret" field in your browser.\n`);
    } catch (err) {
        if (err.code === "EACCES") {
            console.error(`Error: Access denied to ${filePath}. You may need to run this command with sudo:`);
            console.log(`\nsudo npm run secret:reveal\n`);
        } else {
            console.error(`Error: Failed to read secret: ${err.message}`);
        }
        process.exit(1);
    }
}

main();
