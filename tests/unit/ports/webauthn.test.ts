import type {
  AuthenticationResponseJSON as PackageAuthentication,
  PublicKeyCredentialCreationOptionsJSON as PackageCreation,
  PublicKeyCredentialRequestOptionsJSON as PackageRequest,
  RegistrationResponseJSON as PackageRegistration,
} from '@simplewebauthn/browser'
import { describe, expectTypeOf, it } from 'vite-plus/test'
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@/types/webauthn.types'

describe('the webauthn port types', () => {
  it("the local JSON types are assignable to and from @simplewebauthn/browser's", () => {
    expectTypeOf<PublicKeyCredentialRequestOptionsJSON>().toEqualTypeOf<PackageRequest>()
    expectTypeOf<PublicKeyCredentialCreationOptionsJSON>().toEqualTypeOf<PackageCreation>()
    expectTypeOf<AuthenticationResponseJSON>().toEqualTypeOf<PackageAuthentication>()
    expectTypeOf<RegistrationResponseJSON>().toEqualTypeOf<PackageRegistration>()
  })
})
