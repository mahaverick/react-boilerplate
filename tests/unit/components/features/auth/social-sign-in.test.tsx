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

  it('renders Google as a link to the OAuth start route when it is configured', () => {
    render(<SocialSignIn />)

    const google = screen.getByRole('link', { name: 'Continue with Google' })
    expect(google).toHaveAttribute('href', GOOGLE_OAUTH_PATH)
    expect(screen.getByText('Or continue with')).toBeInTheDocument()
    // Only configured providers: the block's Apple and Meta buttons are not drawn.
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders no divider and no button when no provider is configured', () => {
    const { container } = render(<SocialSignIn providers={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders exactly the providers it is given', () => {
    render(
      <SocialSignIn
        providers={[
          { id: 'github', label: 'GitHub', href: '/api/v1/auth/github', Icon: IconBrandGithub },
        ]}
      />
    )

    expect(screen.getByRole('link', { name: 'Continue with GitHub' })).toHaveAttribute(
      'href',
      '/api/v1/auth/github'
    )
    expect(screen.queryByRole('link', { name: 'Continue with Google' })).not.toBeInTheDocument()
  })
})
