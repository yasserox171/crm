import { CircleAlert, Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, errorMessage } from '../api/client'
import { useLogin, useMe } from '../api/hooks'
import { LanguageSwitcher, ThemeSwitcher } from '../components/layout/Preferences'
import { Button } from '../components/ui/Button'
import { Field, Input } from '../components/ui/Form'

export default function LoginPage() {
  const { t } = useTranslation()
  const { data: user } = useMe()
  const login = useLogin()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/contacts'
  if (user) return <Navigate to={from} replace />

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!email || !password) return
    login.mutate({ email: email.trim(), password }, { onSuccess: () => navigate(from, { replace: true }) })
  }

  let error: string | null = null
  if (login.error) {
    if (login.error instanceof ApiError && login.error.status === 429) error = t('login.throttled')
    else if (login.error instanceof ApiError && login.error.code === 'invalid_credentials') error = t('login.invalid')
    else error = errorMessage(login.error)
  }

  return (
    <div className="login">
      <div className="login__prefs">
        <LanguageSwitcher persist={false} />
        <ThemeSwitcher />
      </div>
      <main className="login__panel">
        <div className="login__brand">
          <span className="brand-mark brand-mark--lg" aria-hidden>
            F
          </span>
          <div>
            <p className="login__brand-name">{t('app.name')}</p>
            <p className="subtle">{t('app.product')}</p>
          </div>
        </div>
        <div className="card login__card">
          <h1 className="login__title">{t('login.title')}</h1>
          <p className="muted">{t('login.subtitle')}</p>
          {error && (
            <div className="banner banner--danger" role="alert">
              <CircleAlert aria-hidden />
              <span className="banner__text">{error}</span>
            </div>
          )}
          <form className="stack" onSubmit={submit} noValidate>
            <Field label={t('login.email')}>
              {(props) => (
                <div className="input-group">
                  <Mail className="input-group__icon" aria-hidden />
                  <Input
                    {...props}
                    className="input--with-icon"
                    type="email"
                    autoComplete="username"
                    inputMode="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
              )}
            </Field>
            <Field label={t('login.password')}>
              {(props) => (
                <div className="input-group">
                  <Lock className="input-group__icon" aria-hidden />
                  <Input
                    {...props}
                    className="input--with-icon input--with-suffix"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <Button
                    className="input-group__suffix"
                    variant="ghost"
                    size="sm"
                    iconOnly
                    label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                    icon={showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                    onClick={() => setShowPassword((value) => !value)}
                  />
                </div>
              )}
            </Field>
            <Button type="submit" variant="primary" block loading={login.isPending} disabled={!email || !password}>
              {login.isPending ? t('login.submitting') : t('login.submit')}
            </Button>
          </form>
        </div>
        <p className="login__footnote subtle">{t('login.noAccount')}</p>
      </main>
    </div>
  )
}
