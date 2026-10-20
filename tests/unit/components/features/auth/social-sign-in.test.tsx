import { IconBrandGithub } from '@tabler/icons-react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SocialSignIn } from '@/components/features/auth/social-sign-in'
import { SOCIAL_PROVIDERS } from '@/constants/auth-providers'
import { GOOGLE_OAUTH_PATH } from '@/constants/routes'

describe('SocialSignIn', () => {
  it('lists Google, the one provider the API offers', () => {
    expect(SOCIAL_PROVIDERS.map((provider) => provider.id)).toEqual(['google'])
  })

  it('builds the Google start URL for web, with the redirect when there is one', () => {
    const [google] = SOCIAL_PROVIDERS
    expect(google?.hrefFor()).toBe(`${GOOGLE_OAUTH_PATH}?app=web`)
    expect(google?.hrefFor('/tenants/acme?tab=members')).toBe(
      `${GOOGLE_OAUTH_PATH}?app=web&redirect=%2Ftenants%2Facme%3Ftab%3Dmembers`
    )
  })

  it('renders Google as a link to the OAuth start route, under an "or" divider', () => {
    render(<SocialSignIn />)

    const google = screen.getByRole('link', { name: 'Continue with Google' })
    expect(google).toHaveAttribute('href', `${GOOGLE_OAUTH_PATH}?app=web`)
    expect(screen.getByText('or')).toBeInTheDocument()
    // Only configured providers: the block's Apple and Meta buttons are not drawn.
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('carries the redirect it is given into the start URL', () => {
    render(<SocialSignIn redirect="/tenants/acme" />)

    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/api/v1/auth/google?app=web&redirect=%2Ftenants%2Facme'
    )
  })

  it('renders no divider and no button when no provider is configured', () => {
    const { container } = render(<SocialSignIn providers={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders exactly the providers it is given', () => {
    render(
      <SocialSignIn
        redirect="/x"
        providers={[
          {
            id: 'github',
            label: 'GitHub',
            hrefFor: (redirect) => `/api/v1/auth/github?to=${redirect ?? ''}`,
            Icon: IconBrandGithub,
          },
        ]}
      />
    )

    expect(screen.getByRole('link', { name: 'Continue with GitHub' })).toHaveAttribute(
      'href',
      '/api/v1/auth/github?to=/x'
    )
    expect(screen.queryByRole('link', { name: 'Continue with Google' })).not.toBeInTheDocument()
  })

  it('shows the divider and the extra control first when no provider is configured', () => {
    render(
      <SocialSignIn providers={[]} extra={<button type="button">Sign in with a passkey</button>} />
    )

    expect(screen.getByText('or')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in with a passkey' })).toBeInTheDocument()
  })

  it('puts the extra control before the providers', () => {
    render(<SocialSignIn extra={<button type="button">Sign in with a passkey</button>} />)

    const button = screen.getByRole('button', { name: 'Sign in with a passkey' })
    const link = screen.getByRole('link', { name: 'Continue with Google' })
    expect(button.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
