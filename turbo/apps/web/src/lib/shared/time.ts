/**
 * Return a Date representing the start of the day (00:00:00) in the given
 * timezone, preserving the input's millisecond offset from the true second.
 */
export function startOfDayInTz(date: Date, tz: string): Date {
  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = parseInt(
    timeParts.find((p) => {
      return p.type === "hour";
    })?.value ?? "0",
  );
  const minute = parseInt(
    timeParts.find((p) => {
      return p.type === "minute";
    })?.value ?? "0",
  );
  const second = parseInt(
    timeParts.find((p) => {
      return p.type === "second";
    })?.value ?? "0",
  );

  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const targetYear = parseInt(
    dateParts.find((p) => {
      return p.type === "year";
    })?.value ?? "0",
  );
  const targetMonth = parseInt(
    dateParts.find((p) => {
      return p.type === "month";
    })?.value ?? "1",
  );
  const targetDay = parseInt(
    dateParts.find((p) => {
      return p.type === "day";
    })?.value ?? "1",
  );

  const elapsed = ((hour * 60 + minute) * 60 + second) * 1000;
  let result = new Date(date.getTime() - elapsed);

  const verify = (d: Date): boolean => {
    const dp = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const y = parseInt(
      dp.find((p) => {
        return p.type === "year";
      })?.value ?? "0",
    );
    const m = parseInt(
      dp.find((p) => {
        return p.type === "month";
      })?.value ?? "1",
    );
    const day = parseInt(
      dp.find((p) => {
        return p.type === "day";
      })?.value ?? "1",
    );
    const h = parseInt(
      dp.find((p) => {
        return p.type === "hour";
      })?.value ?? "0",
    );
    const min = parseInt(
      dp.find((p) => {
        return p.type === "minute";
      })?.value ?? "0",
    );
    const s = parseInt(
      dp.find((p) => {
        return p.type === "second";
      })?.value ?? "0",
    );
    return (
      y === targetYear &&
      m === targetMonth &&
      day === targetDay &&
      h === 0 &&
      min === 0 &&
      s === 0
    );
  };

  if (!verify(result)) {
    const baseTime = result.getTime();
    for (const delta of [3600000, -3600000, 7200000, -7200000]) {
      const candidate = new Date(baseTime + delta);
      if (verify(candidate)) {
        result = candidate;
        break;
      }
    }
  }

  return result;
}
