// NOAA solar-position algorithm (the spreadsheet method), all in UTC.
// Shared by the Daylight view (sun dome + solar timeline) and the Weather &
// Runways sky scene (day / twilight / night tint, sun glow position).

export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;

export interface Solar {
	elevation: number; // degrees above horizon (negative = below)
	azimuth: number; // degrees true, clockwise from north
	decl: number; // solar declination
	sunriseMin: number | null; // minutes from UTC midnight
	sunsetMin: number | null;
	solarNoonMin: number;
	dayLengthMin: number | null;
	civilDawnMin: number | null;
	civilDuskMin: number | null;
}

// NOAA solar-position algorithm (the spreadsheet method), all in UTC.
export function solar(latDeg: number, lonDeg: number, date: Date): Solar {
	const jd = date.getTime() / 86400000 + 2440587.5;
	const jc = (jd - 2451545) / 36525;
	const gmls = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360; // mean long
	const gmas = 357.52911 + jc * (35999.05029 - 0.0001537 * jc); // mean anomaly
	const eeo = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
	const seoc =
		Math.sin(gmas * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
		Math.sin(2 * gmas * RAD) * (0.019993 - 0.000101 * jc) +
		Math.sin(3 * gmas * RAD) * 0.000289;
	const stl = gmls + seoc; // true longitude
	const sal = stl - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * jc) * RAD); // apparent
	const moe = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
	const oc = moe + 0.00256 * Math.cos((125.04 - 1934.136 * jc) * RAD); // obliquity corr
	const decl = Math.asin(Math.sin(oc * RAD) * Math.sin(sal * RAD)) * DEG;
	const y = Math.tan((oc / 2) * RAD) ** 2;
	const eqTime =
		4 *
		DEG *
		(y * Math.sin(2 * gmls * RAD) -
			2 * eeo * Math.sin(gmas * RAD) +
			4 * eeo * y * Math.sin(gmas * RAD) * Math.cos(2 * gmls * RAD) -
			0.5 * y * y * Math.sin(4 * gmls * RAD) -
			1.25 * eeo * eeo * Math.sin(2 * gmas * RAD)); // minutes

	const utMin =
		date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
	const trueSolarTime = (((utMin + eqTime + 4 * lonDeg) % 1440) + 1440) % 1440;
	let ha = trueSolarTime / 4 - 180; // hour angle, deg
	if (ha < -180) ha += 360;
	const zenith =
		Math.acos(
			Math.sin(latDeg * RAD) * Math.sin(decl * RAD) +
				Math.cos(latDeg * RAD) * Math.cos(decl * RAD) * Math.cos(ha * RAD)
		) * DEG;
	const elevation = 90 - zenith;

	let azimuth: number;
	const denom = Math.cos(latDeg * RAD) * Math.sin(zenith * RAD);
	if (Math.abs(denom) > 1e-9) {
		let az =
			Math.acos(
				Math.min(
					1,
					Math.max(-1, (Math.sin(latDeg * RAD) * Math.cos(zenith * RAD) - Math.sin(decl * RAD)) / denom)
				)
			) * DEG;
		azimuth = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
	} else {
		azimuth = latDeg > decl ? 180 : 0;
	}

	const solarNoonMin = 720 - 4 * lonDeg - eqTime;
	// Hour angle for a given zenith (90.833° = sunrise/set incl. refraction; 96° = civil).
	const haFor = (z: number): number | null => {
		const c =
			Math.cos(z * RAD) / (Math.cos(latDeg * RAD) * Math.cos(decl * RAD)) -
			Math.tan(latDeg * RAD) * Math.tan(decl * RAD);
		if (c < -1 || c > 1) return null; // sun never reaches this altitude today
		return Math.acos(c) * DEG;
	};
	const haRise = haFor(90.833);
	const haCivil = haFor(96);
	return {
		elevation,
		azimuth,
		decl,
		solarNoonMin,
		sunriseMin: haRise == null ? null : solarNoonMin - haRise * 4,
		sunsetMin: haRise == null ? null : solarNoonMin + haRise * 4,
		dayLengthMin: haRise == null ? null : 8 * haRise,
		civilDawnMin: haCivil == null ? null : solarNoonMin - haCivil * 4,
		civilDuskMin: haCivil == null ? null : solarNoonMin + haCivil * 4
	};
}
