import { getSupportedTokens } from 'paj_ramp';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  try {
    const tokens = await getSupportedTokens();
    console.log("Supported PajCash Tokens:");
    console.log(JSON.stringify(tokens, null, 2));
  } catch (error) {
    console.error("Error fetching tokens:", error);
  }
}
run();
