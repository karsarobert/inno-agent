export interface TopicPromptMessage {
	role: string;
	content: string;
}

/** Build a language-neutral prompt for a concise session title. */
export function buildSessionTopicPrompt(messages: TopicPromptMessage[]): string {
	const excerpt = messages
		.slice(0, 4)
		.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content.replace(/\s+/g, " ").trim()}`)
		.join("\n")
		.slice(0, 800);

	if (!excerpt) return "";

	return `Generate a concise topic title for the conversation below.
Requirements:
- Output only the title, without quotation marks or explanation.
- Use 4 to 10 words where the language permits.
- Write the title in the same language as the user's first message. Do not translate it into Chinese unless the user's first message is Chinese.
- Do not use a trailing period or colon.

Conversation:
${excerpt}`;
}
