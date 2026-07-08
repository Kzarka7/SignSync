export default function Badge({ tone, children }: { tone: 'ok' | 'med'; children: React.ReactNode }) {
  const styles = tone === 'ok' ? 'bg-success-light text-[#136b3b]' : 'bg-amber-light text-[#8a5a10]'
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${styles}`}>{children}</span>
}
