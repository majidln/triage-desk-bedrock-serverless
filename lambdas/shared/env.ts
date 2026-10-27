// Reads a required environment variable. Call it at module load, so a missing variable
// fails the cold start with a clear message, before any request or message is touched.
export function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable ${name}`);
    }
    return value;
}
