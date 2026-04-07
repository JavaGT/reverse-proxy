import dotenv from "dotenv";
import { generateSecret, writeSecretFile } from "../src/shared/utils/SecretUtils.mjs";

dotenv.config();

/**
 * CLI utility to rotate the management secret key.
 * Reads the file path from MANAGEMENT_SECRET_FILE in .env.
 */
function main() {
    const filePath = process.env.MANAGEMENT_SECRET_FILE;

    if (!filePath) {
        console.error("Error: MANAGEMENT_SECRET_FILE is not defined in .env");
        process.exit(1);
    }

    try {
        const newSecret = generateSecret();
        writeSecretFile(filePath, newSecret);
        console.log(`Success: Secret rotated in ${filePath}`);
        console.log(`New Secret: ${newSecret}`);
    } catch (err) {
        console.error(`Error: Failed to rotate secret: ${err.message}`);
        process.exit(1);
    }
}

main();
