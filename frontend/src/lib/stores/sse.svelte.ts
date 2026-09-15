import { getSSEUrl } from '$lib/api/client';

type EventHandler = (data: unknown, eventType: string) => void;

class SSEConnection {
	#eventSource: EventSource | null = null;
	#exactHandlers = new Map<string, Set<EventHandler>>();
	#prefixHandlers = new Map<string, EventHandler>();

	connected = $state(false);
	lastEvent = $state<string | null>(null);
	error = $state<string | null>(null);
	#registeredTypes = new Set<string>();

	connect() {
		if (this.#eventSource) return;

		const url = getSSEUrl();
		this.#eventSource = new EventSource(url);

		this.#eventSource.onopen = () => {
			this.connected = true;
			this.error = null;
		};

		this.#eventSource.onerror = () => {
			this.connected = false;
			this.error = 'Connection lost. Reconnecting...';
		};

		// Register listeners for all known exact handler types
		for (const type of this.#exactHandlers.keys()) {
			this.#ensureListener(type);
		}
	}

	/**
	 * Ensure an EventSource listener exists for a given event type.
	 * The listener dispatches dynamically to all registered handlers
	 * (both exact and prefix) at call time.
	 */
	#ensureListener(type: string) {
		if (!this.#eventSource || this.#registeredTypes.has(type)) return;
		this.#registeredTypes.add(type);
		this.#eventSource.addEventListener(type, (e: MessageEvent) => {
			this.lastEvent = new Date().toISOString();
			try {
				const data = JSON.parse(e.data);

				// Dispatch to all exact handlers for this type
				const handlers = this.#exactHandlers.get(type);
				if (handlers) {
					for (const handler of handlers) {
						handler(data, type);
					}
				}

				// Dispatch to matching prefix handlers
				for (const [prefix, handler] of this.#prefixHandlers) {
					if (type.startsWith(prefix)) {
						handler(data, type);
					}
				}
			} catch {
				// ignore parse errors
			}
		});
	}

	/**
	 * Register handler for exact event type match.
	 * Returns an unsubscribe function for cleanup.
	 */
	on(type: string, handler: EventHandler): () => void {
		if (!this.#exactHandlers.has(type)) {
			this.#exactHandlers.set(type, new Set());
		}
		this.#exactHandlers.get(type)!.add(handler);

		if (this.#eventSource) {
			this.#ensureListener(type);
		}

		// Return unsubscribe function
		return () => {
			const handlers = this.#exactHandlers.get(type);
			if (handlers) {
				handlers.delete(handler);
				if (handlers.size === 0) {
					this.#exactHandlers.delete(type);
				}
			}
		};
	}

	/**
	 * Register handler for events matching a prefix (e.g., "portainer:" matches "portainer:prod").
	 * The handler receives the full event type as second arg.
	 */
	onPrefix(prefix: string, handler: EventHandler) {
		this.#prefixHandlers.set(prefix, handler);
	}

	/**
	 * Register a dynamic event type at runtime (e.g., from service discovery).
	 * Ensures an EventSource listener exists so events are dispatched to
	 * any matching exact or prefix handlers.
	 */
	registerEventType(type: string) {
		if (this.#registeredTypes.has(type) || !this.#eventSource) return;
		this.#ensureListener(type);
	}

	disconnect() {
		this.#eventSource?.close();
		this.#eventSource = null;
		this.connected = false;
		this.#registeredTypes.clear();
	}
}

export const sseConnection = new SSEConnection();
