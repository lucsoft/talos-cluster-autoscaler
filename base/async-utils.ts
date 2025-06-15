export async function repeatUntilSuccess(action: () => Promise<void>) {
    let successfully = false;
    while (!successfully) {
        try {
            await action();
            successfully = true;
        } catch {
            //
        }
    }
}

export async function repeatUntilFailure(action: () => Promise<void>) {
    let successfully = false;
    while (!successfully) {
        try {
            await action();
        } catch {
            successfully = true;
            //
        }
    }
}