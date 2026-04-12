import styles from "./results.module.css";

type ResultSignal = { label: string };
type ResultEvent = { id: string; title: string; time: string; attendees: number };
type ResultSummary = {
  score: number;
  deltaPct: number;
  signals: ResultSignal[];
  events: ResultEvent[];
};

async function getResultsSummary(): Promise<ResultSummary> {
  return {
    score: 84,
    deltaPct: 2.3,
    signals: [
      { label: "Sustainability" },
      { label: "Quality" },
      { label: "Customer Care" },
      { label: "Price Value" },
      { label: "Design" },
    ],
    events: [
      { id: "1", title: "Brand Sentiment Deep-Dive", time: "2:30 PM", attendees: 4 },
      { id: "2", title: "Category Trend Review", time: "4:10 PM", attendees: 3 },
      { id: "3", title: "Weekly Ratings Sync", time: "6:00 PM", attendees: 6 },
    ],
  };
}

export default async function ResultsPage() {
  const data = await getResultsSummary();

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Results</p>
            <h1 className={styles.title}>Brand Rating Summary</h1>
          </div>
          <button className={styles.iconBtn} aria-label="settings">⚙</button>
        </header>

        <section className={styles.heroCard}>
          <div>
            <p className={styles.label}>Overall Score</p>
            <p className={styles.score}>{data.score}</p>
            <p className={styles.delta}>{data.deltaPct >= 0 ? "+" : ""}{data.deltaPct}% this week</p>
          </div>
          <div className={styles.sparkWrap} aria-hidden>
            <div className={styles.sparkLine} />
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Top Signals</h2>
          <div className={styles.chipRow}>
            {data.signals.map((signal) => (
              <span key={signal.label} className={styles.chip}>{signal.label}</span>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Upcoming Items</h2>
          <div className={styles.list}>
            {data.events.map((event) => (
              <article key={event.id} className={styles.item}>
                <div>
                  <p className={styles.itemTitle}>{event.title}</p>
                  <p className={styles.itemMeta}>{event.time}</p>
                </div>
                <p className={styles.itemMeta}>+{event.attendees}</p>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
