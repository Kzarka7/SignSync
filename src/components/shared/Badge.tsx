export default function Badge({ tone, children, className }: { tone: 'ok' | 'med'; children: React.ReactNode; className?: string }) {
  const styles = tone === 'ok' ? 'bg-success-light text-success-dark' : 'bg-amber-light text-amber-dark'
  return <span className={`text-sm font-semibold px-2.5 py-1 rounded-md ${styles} ${className || ''}`}>{children}</span>
}
