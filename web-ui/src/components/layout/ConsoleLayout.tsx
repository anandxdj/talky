import {
  Activity,
  BarChart3,
  Inbox,
  Menu,
  MessageCircle,
  Settings2,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { BrandMark } from '@/components/talky/BrandMark'
import { PausedBanner } from '@/components/talky/PauseReplies'
import { ThemeToggle } from '@/components/ThemeToggle'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { useTalkyConsole } from '@/context/TalkyConsoleContext'
import { useRepliesPause } from '@/hooks/use-replies-pause'
import { cn } from '@/lib/utils'

type NavItem = { to: string; label: string; short: string; icon: LucideIcon; badge?: 'queue' }

const MONITOR: NavItem[] = [
  { to: '/overview', label: 'Overview', short: 'Overview', icon: BarChart3 },
  { to: '/queue', label: 'Live queue', short: 'Queue', icon: Inbox, badge: 'queue' },
  { to: '/conversations', label: 'Conversations', short: 'Chats', icon: MessageCircle },
]
const TUNE: NavItem[] = [
  { to: '/voice', label: 'Voice & persona', short: 'Voice', icon: Activity },
  { to: '/access', label: 'Access rules', short: 'Access', icon: ShieldCheck },
  { to: '/settings', label: 'Settings', short: 'Settings', icon: Settings2 },
]

function useQueueCount(): number {
  const { claudePending, unauthorized } = useTalkyConsole()
  return claudePending.length + unauthorized.length
}

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  const location = useLocation()
  const queueCount = useQueueCount()
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="font-mono text-[11px] tracking-[0.08em] text-sidebar-foreground/60 uppercase">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map(({ to, label: itemLabel, icon: Icon, badge }) => (
            <SidebarMenuItem key={to}>
              <SidebarMenuButton
                isActive={location.pathname.startsWith(to)}
                tooltip={itemLabel}
                render={<NavLink to={to} onClick={() => setOpenMobile(false)} />}
                className="h-10"
              >
                <Icon />
                <span>{itemLabel}</span>
              </SidebarMenuButton>
              {badge === 'queue' && queueCount > 0 ? (
                <SidebarMenuBadge className="bg-series-claude font-mono text-[#141413] peer-hover/menu-button:text-[#141413] peer-data-active/menu-button:text-[#141413]">
                  {queueCount}
                </SidebarMenuBadge>
              ) : null}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function ConnectionCard() {
  const { status, claudeStatus, offline } = useTalkyConsole()
  const connected = status?.whatsappConnected === true
  const label = offline
    ? 'Bot offline'
    : connected
      ? 'Linked'
      : status?.whatsappNeedsQr
        ? 'Needs QR scan'
        : 'Connecting…'
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-sidebar-border p-3 font-mono text-xs group-data-[collapsible=icon]:hidden">
      <span className="flex items-center gap-2 text-sidebar-accent-foreground">
        <StatusDot state={offline ? 'bad' : connected ? 'good' : 'warn'} />
        {label}
      </span>
      <span className="truncate text-sidebar-foreground/70">
        {claudeStatus?.ownJid ? claudeStatus.ownJid.split('@')[0] : '—'}
      </span>
    </div>
  )
}

export function StatusDot({ state }: { state: 'good' | 'warn' | 'bad' }) {
  const color =
    state === 'good'
      ? 'var(--status-good)'
      : state === 'warn'
        ? 'var(--status-warning)'
        : 'var(--status-critical)'
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ background: color }}
    />
  )
}

/** Mono status strip across the top of every page. */
function StatusStrip() {
  const { status, config, claudeStatus, stats, offline } = useTalkyConsole()
  const engine = !claudeStatus?.mediatorEnabled
    ? 'gemini'
    : claudeStatus.mediatorExclusive
      ? 'claude (exclusive)'
      : 'claude + gemini'
  const { paused } = useRepliesPause()
  const connected = status?.whatsappConnected === true
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b bg-card px-4 py-2 font-mono text-xs text-muted-foreground md:px-8">
      <span className="flex items-center gap-1.5 font-semibold text-foreground">
        <StatusDot state={offline ? 'bad' : connected && !paused ? 'good' : 'warn'} />
        {offline ? 'OFFLINE' : !connected ? 'NOT LINKED' : paused ? 'PAUSED' : 'LIVE'}
      </span>
      <span>engine: {engine}</span>
      {stats ? (
        <span>
          sent today {stats.today.sentByTalky}/{stats.today.dailyLimit}
        </span>
      ) : null}
      <span className="hidden sm:inline">queue {claudeStatus?.pendingCount ?? 0}</span>
      {typeof config?.model === 'string' ? (
        <span className="hidden lg:inline">model {config.model}</span>
      ) : null}
      {stats ? (
        <span className="ml-auto hidden md:inline">
          updated {new Date(stats.generatedAtISO).toLocaleTimeString()}
        </span>
      ) : null}
    </div>
  )
}

/** Phone-width navigation: four primary tabs plus "More" (opens the full rail as a sheet). */
function BottomTabs() {
  const location = useLocation()
  const queueCount = useQueueCount()
  const { setOpenMobile } = useSidebar()
  const tabs = [MONITOR[0]!, MONITOR[1]!, MONITOR[2]!, TUNE[0]!]
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {tabs.map(({ to, short, icon: Icon, badge }) => {
        const active = location.pathname.startsWith(to)
        return (
          <NavLink
            key={to}
            to={to}
            className={cn(
              'relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium',
              active ? 'text-foreground' : 'text-muted-foreground',
            )}
            aria-current={active ? 'page' : undefined}
          >
            <Icon className="size-5" aria-hidden />
            {short}
            {badge === 'queue' && queueCount > 0 ? (
              <span className="absolute top-1.5 left-[calc(50%+6px)] rounded-full bg-series-claude px-1.5 font-mono text-[10px] font-semibold text-[#141413]">
                {queueCount}
              </span>
            ) : null}
          </NavLink>
        )
      })}
      <button
        type="button"
        onClick={() => setOpenMobile(true)}
        className="flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground"
      >
        <Menu className="size-5" aria-hidden />
        More
      </button>
    </nav>
  )
}

export function ConsoleLayout() {
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="px-3 pt-4 pb-3">
          <div className="flex items-center gap-2.5 px-1">
            <BrandMark className="size-7 shrink-0" />
            <span className="text-[17px] font-semibold tracking-tight text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden">
              talky
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <NavGroup label="Monitor" items={MONITOR} />
          <NavGroup label="Tune" items={TUNE} />
        </SidebarContent>
        <SidebarFooter className="gap-2 p-3">
          <ConnectionCard />
          <ThemeToggle />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0 bg-background">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-3 md:hidden">
          <BrandMark className="size-6" />
          <span className="font-semibold tracking-tight">talky</span>
          <SidebarTrigger className="ml-auto" />
        </header>
        <div className="hidden items-center border-b bg-card md:flex">
          <SidebarTrigger className="ml-2" />
          <div className="flex-1">
            <StatusStrip />
          </div>
        </div>
        <div className="md:hidden">
          <StatusStrip />
        </div>
        <PausedBanner />
        <div className="flex flex-1 flex-col gap-5 px-4 pt-6 pb-24 md:px-8 md:pb-12">
          <Outlet />
        </div>
      </SidebarInset>
      <BottomTabs />
    </SidebarProvider>
  )
}
