const privateIds = new Set<string>();

export function markConversationPrivate(id: string): void {
    privateIds.add(id);
}

export function isConversationPrivate(id: string): boolean {
    return privateIds.has(id);
}

export function clearPrivateConversations(): void {
    privateIds.clear();
}
