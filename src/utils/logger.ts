import type { Ora } from "ora";
export class Logger {
    private spinner: Ora | null = null;

    setSpinner(spinner: Ora) {
        this.spinner = spinner;
    }

    clearSpinner() {
        this.spinner = null;
    }

    log(message: string) {
        if (this.spinner) {
            this.spinner.text = message;
        } else {
            console.log(message);
        }
    }

    success(message: string) {
        console.log(`✓ ${message}`);
    }

    error(message: string) {
        console.error(`✗ ${message}`);
    }

    warn(message: string) {
        console.warn(`⚠ ${message}`);
    }

    info(message: string) {
        console.info(`ℹ ${message}`);
    }
}

export const logger = new Logger();