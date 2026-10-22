import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, Smartphone, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useLogout, useMe, useOutbox, useWaChats, useWhatsAppStatus } from '../../api/hooks'
import { readStorage, writeStorage } from '../../lib/storage'
import { useManualMode } from '../messaging/useManualMode'
import { useWebMode } from '../messaging/useWebMode'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { LanguageSwitcher, ThemeSwitcher } from './Preferences'
import { NAV_ITEMS } from './nav'

const COLLAPSE_KEY = 'focus-sidebar-collapsed'

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden>
      F
    </span>
  )
}

export function AppShell() {
  const { t } = useTranslation()
  const { data: user } = useMe()
  const logout = useLogout()
  // Manual WhatsApp mode: show how many messages wait to be sent on the Reminders item.
  const manual = useManualMode()
  const toSend = useOutbox(manual).data?.count ?? 0
  // Linked WhatsApp account: entry to the connection page, with a live status dot.
  const web = useWebMode()
  const waConnected = useWhatsAppStatus(web).data?.state === 'connected'
  const unreadChats = (useWaChats(web && waConnected).data ?? []).reduce((sum, chat) => sum + chat.unread, 0)
  const navItems = NAV_ITEMS.filter((item) => !item.webOnly || web)
  const whatsappLink = (className: string) =>
    web && (
      <NavLink to="/whatsapp" className={className} title={collapsed ? t('nav.whatsapp') : undefined}>
        <span className="wa-nav-icon">
          <Smartphone aria-hidden />
          <span className={`wa-dot wa-dot--${waConnected ? 'on' : 'off'}`} aria-hidden />
        </span>
        <span className="nav-label">{t('nav.whatsapp')}</span>
        <span className="sr-only">{waConnected ? t('wa.state.connected') : t('wa.state.disconnected')}</span>
      </NavLink>
    )
  const badgeFor = (to: string) => {
    const count = to === '/reminders' && manual ? toSend : to === '/chats' ? unreadChats : 0
    return count > 0 ? (
      <span className="nav-badge tabular" aria-label={to === '/chats' ? t('chats.unread', { count }) : t('outbox.title')}>
        {count > 99 ? '99+' : count}
      </span>
    ) : null
  }
  const navigate = useNavigate()
  const location = useLocation()
  // Default to the icon rail on medium screens so wide tables keep their room.
  const [collapsed, setCollapsed] = useState(() => {
    const saved = readStorage(COLLAPSE_KEY)
    return saved === null ? window.innerWidth < 1400 : saved === '1'
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const drawerRef = useRef<HTMLDialogElement>(null)

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      writeStorage(COLLAPSE_KEY, value ? '0' : '1')
      return !value
    })
  }

  useEffect(() => {
    const drawer = drawerRef.current
    if (!drawer) return
    if (menuOpen && !drawer.open) drawer.showModal()
    if (!menuOpen && drawer.open) drawer.close()
  }, [menuOpen])

  const signOut = () =>
    logout.mutate(undefined, {
      onSettled: () => navigate('/login', { replace: true }),
    })

  const currentItem = NAV_ITEMS.find((item) => location.pathname.startsWith(item.to))
  const name = user?.display_name ?? ''

  return (
    <div className="shell" data-collapsed={collapsed}>
      <aside className="sidebar" aria-label={t('nav.main')}>
        <div className="sidebar__brand">
          <BrandMark />
          <span className="brand-text">
            <strong>{t('app.name')}</strong>
            <span>{t('app.product')}</span>
          </span>
        </div>
        <nav className="sidebar__nav">
          {navItems.map(({ to, labelKey, icon: Icon }) => (
            <NavLink key={to} to={to} className="nav-link" title={collapsed ? t(labelKey) : undefined}>
              <Icon aria-hidden />
              <span className="nav-label">{t(labelKey)}</span>
              {badgeFor(to)}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          <div className="sidebar__prefs">
            <div className="pref-row">
              <span className="pref-row__label">{t('prefs.language')}</span>
              <LanguageSwitcher />
            </div>
            <div className="pref-row">
              <span className="pref-row__label">{t('prefs.theme')}</span>
              <ThemeSwitcher />
            </div>
          </div>
          <div className="sidebar__user" title={user?.email}>
            <Avatar name={name} />
            <span className="sidebar__user-text">
              <span>{name}</span>
              {user?.email !== name && <span className="subtle">{user?.email}</span>}
            </span>
          </div>
          {whatsappLink('nav-link')}
          <button type="button" className="nav-link" onClick={signOut} title={collapsed ? t('prefs.logout') : undefined}>
            <LogOut className="flip-rtl" aria-hidden />
            <span className="nav-label">{t('prefs.logout')}</span>
          </button>
          <button
            type="button"
            className="nav-link"
            onClick={toggleCollapsed}
            aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
            title={collapsed ? t('nav.expand') : undefined}
          >
            {collapsed ? <PanelLeftOpen className="flip-rtl" aria-hidden /> : <PanelLeftClose className="flip-rtl" aria-hidden />}
            <span className="nav-label">{t('nav.collapse')}</span>
          </button>
        </div>
      </aside>

      <header className="topbar">
        <Button variant="ghost" iconOnly label={t('nav.openMenu')} icon={<Menu aria-hidden />} onClick={() => setMenuOpen(true)} />
        <span className="topbar__title">
          {currentItem ? t(currentItem.labelKey) : location.pathname.startsWith('/whatsapp') ? t('wa.title') : t('app.name')}
        </span>
        <BrandMark />
      </header>

      <dialog
        ref={drawerRef}
        className="drawer"
        aria-label={t('nav.openMenu')}
        onCancel={(event) => {
          event.preventDefault()
          setMenuOpen(false)
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setMenuOpen(false)
        }}
      >
        <div className="drawer__header">
          <div className="row">
            <BrandMark />
            <span className="brand-text">
              <strong>{t('app.name')}</strong>
              <span>{t('app.product')}</span>
            </span>
          </div>
          <Button variant="ghost" iconOnly label={t('nav.closeMenu')} icon={<X aria-hidden />} onClick={() => setMenuOpen(false)} />
        </div>
        <div className="drawer__section">
          <span className="drawer__section-title">{t('prefs.display')}</span>
          <div className="pref-row">
            <span>{t('prefs.language')}</span>
            <LanguageSwitcher />
          </div>
          <div className="pref-row">
            <span>{t('prefs.theme')}</span>
            <ThemeSwitcher />
          </div>
        </div>
        {web && (
          <div className="drawer__section" onClick={() => setMenuOpen(false)}>
            {whatsappLink('nav-link')}
          </div>
        )}
        <div className="drawer__section">
          <span className="drawer__section-title">{t('prefs.account')}</span>
          <div className="row">
            <Avatar name={name} />
            <span className="sidebar__user-text">
              <span>{name}</span>
              {user?.email !== name && <span className="subtle">{user?.email}</span>}
            </span>
          </div>
        </div>
        <div className="drawer__footer">
          <Button block icon={<LogOut className="flip-rtl" aria-hidden />} onClick={signOut} loading={logout.isPending}>
            {t('prefs.logout')}
          </Button>
        </div>
      </dialog>

      <main className="shell__main" id="main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label={t('nav.main')} style={{ '--tab-count': navItems.length } as CSSProperties}>
        {navItems.map(({ to, labelKey, icon: Icon }) => (
          <NavLink key={to} to={to} className="tab-link">
            <span className="tab-link__icon">
              <Icon aria-hidden />
              {badgeFor(to)}
            </span>
            <span>{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
