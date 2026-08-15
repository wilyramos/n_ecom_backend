// File: src/server.ts

import express from 'express'
import morgan from 'morgan'
import connectDB from './config/db'
import dotenv from 'dotenv'
import path from 'path'
import authRouter from './routes/authRouter'
import productRouter from './routes/productRouter'
import categoryRouter from './routes/categoryRouter'
import cartRouter from './routes/cartRouter'
import orderRouter from './routes/orderRouter'
import checkoutRouter from './routes/checkoutRouter'
import saleRouter from './routes/saleRouter'
import userRouter from './routes/userRouter'
import purchaseRouter from './routes/purchaseRouter'
import brandRouter from './routes/brandRouter'
import sectionRouter from './modules/section/section.router'
import advertisementRouter from './modules/advertisement/advertisement.routes'
import pageRouter from './modules/page/page.routes'

// Cors
import cors from 'cors'
import { globalErrorHandler } from './middleware/error.middleware'
import lineRouter from './routes/line.router'

// v2
import productRouterV2 from './modules/product/product.routes'
import saleRouterV2 from './modules/sale/sale.routes'
import cashRouter from './modules/cash/cash.routes'
import reportRouter from './modules/reports/report.routes'
import sliderBannerRouter from './modules/sliderbanner/sliderbanner.routes'
import claimRouter from './modules/claim/claim.router'
import userRouterV2 from './modules/users/users.router'
import attendanceRouter from './modules/attendance/attendance.routes'

// Módulos Renovados (v3 / Modular Pattern)
import pedidoRouter from './modules/pedidos/pedido.routes'
import webhookRouterV3 from './modules/webhooks/webhook.routes'
import ticketRouter from './modules/ticket/ticket.routes'

import setupSwagger from './config/swagger.config'
import collectionRouter from './modules/collection/collection.router'

dotenv.config()

const app = express()

connectDB()

app.use(morgan('dev'))
app.use(express.json())

// Servir archivos estáticos temporales para previsualización en el frontend
app.use('/uploads/temp', express.static(path.join(process.cwd(), 'uploads/temp')))

// Cors
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}))

app.get('/', (req, res) => {
    res.send('API is running...')
})

setupSwagger(app)

// Nuevos Módulos Renovados v3
app.use('/api/pedidos', pedidoRouter)
app.use(
    '/api/webhooks',
    express.urlencoded({ extended: true }),
    webhookRouterV3
)
app.use('/api/tickets', ticketRouter)

// Version 2.0: Refactor to use controllers and services for products and sales
app.use('/api/products/v2', productRouterV2)
app.use('/api/sales/v2', saleRouterV2)
app.use('/api/cash/v2', cashRouter)
app.use('/api/users/v2', userRouterV2)
app.use('/api/reports/v2', reportRouter)
app.use('/api/slider-banners', sliderBannerRouter)
app.use('/api/collections', collectionRouter)
app.use('/api/claims', claimRouter)
app.use('/api/sections', sectionRouter)
app.use('/api/advertisements', advertisementRouter)
app.use('/api/attendance', attendanceRouter)
app.use('/api/pages', pageRouter)

// Routers Legacy
app.use('/api/auth', authRouter)
app.use('/api/users', userRouter)
app.use('/api/category', categoryRouter)
app.use('/api/brands', brandRouter)
app.use('/api/products', productRouter)
app.use('/api/cart', cartRouter)
app.use('/api/orders', orderRouter)
app.use('/api/checkout', checkoutRouter)
app.use('/api/sales', saleRouter)
app.use('/api/lines', lineRouter)
app.use('/api/purchases', purchaseRouter)

// Middleware global for error handling 
app.use(globalErrorHandler)

export default app