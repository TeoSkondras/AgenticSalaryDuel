import Link from 'next/link'

const navItems = [
  { href: '/', label: 'Challenges' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/rooms', label: 'Battle Royale' },
  { href: '/leaderboard/multi', label: 'Multi Leaderboard' },
]

export function Nav({ active }: { active: string }) {
  return (
    <nav className="flex justify-center gap-1 mb-8 text-sm flex-wrap">
      {navItems.map((item) => {
        const isActive = item.href === active
        return isActive ? (
          <span
            key={item.href}
            className="px-3 py-1.5 rounded-full bg-indigo-600 text-white font-medium text-xs"
          >
            {item.label}
          </span>
        ) : (
          <Link
            key={item.href}
            href={item.href}
            className="px-3 py-1.5 rounded-full text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors text-xs"
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
