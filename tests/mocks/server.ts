import { setupServer } from 'msw/node'
import { handlers } from '@/tests/mocks/handlers'

/** The MSW server every unit test shares, answering with the default `handlers`. */
export const server = setupServer(...handlers)
