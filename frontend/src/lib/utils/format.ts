export function formatBytes(bytes: number, decimals = 1): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function formatDuration(seconds: number): string {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

export function formatPercentage(value: number, decimals = 1): string {
	return `${value.toFixed(decimals)}%`;
}

export function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return n.toLocaleString();
}

export function formatMs(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

/** Parse K8s memory strings like "32503312Ki", "8Gi", "500Mi" to bytes */
export function parseK8sMemory(s: string): number {
	if (!s) return 0;
	const match = s.match(/^(\d+(?:\.\d+)?)\s*(Ki|Mi|Gi|Ti|Pi|k|M|G|T|P)?$/);
	if (!match) return parseFloat(s) || 0;
	const value = parseFloat(match[1]);
	const unit = match[2];
	const multipliers: Record<string, number> = {
		Ki: 1024,
		Mi: 1024 ** 2,
		Gi: 1024 ** 3,
		Ti: 1024 ** 4,
		Pi: 1024 ** 5,
		k: 1000,
		M: 1000 ** 2,
		G: 1000 ** 3,
		T: 1000 ** 4,
		P: 1000 ** 5,
	};
	return value * (multipliers[unit] || 1);
}

/** Parse K8s CPU strings like "8", "500m" to cores as float */
export function parseK8sCpu(s: string): number {
	if (!s) return 0;
	if (s.endsWith('m')) return parseFloat(s) / 1000;
	if (s.endsWith('n')) return parseFloat(s) / 1_000_000_000;
	return parseFloat(s) || 0;
}
