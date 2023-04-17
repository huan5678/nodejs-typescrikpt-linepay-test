import path from 'path';
import bodyParser from 'body-parser';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import {Configuration, OpenAIApi} from 'openai';
import dotenv from 'dotenv';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import { createLinePayClient } from 'line-pay-merchant';

const app = express();
const port = 3000;

app.use(express.static(path.join(__dirname, 'pages')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'pages'));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(express.json());
dotenv.config();


const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);


app.get('/', (req: Request, res: Response) =>
{
  const data = '';

  res.render('index', {data});
});

app.post('/', async (req, res, next) => {
  try {
    const chatCompletion = await openai.createChatCompletion({
      model: req.body.model || 'gpt-3.5-turbo',
      temperature: req.body.temperature || 0.9,
      messages: [
        {
          role: 'system',
          content: '你是高級人工智慧, AI助手, 中文為你的預設回答語言',
        },
        {
          role: 'user',
          content: req.body.message,
        },
      ],
    });
    console.log(chatCompletion.data.choices[0].message?.content);
    res.send({
      message: chatCompletion.data.choices[0].message?.content,
      finish_reason: chatCompletion.data.choices[0].finish_reason,
      id: chatCompletion.data.id,
    });
  } catch (error) {
    // console.error(error);
    console.log(error.response.data);
    next(error);
  }
});

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      LINE_PAY_CHANNEL_ID: string;
      LINE_PAY_CHANNEL_SECRET: string;
      LINE_PAY_ENV: 'development' | 'production';
      NODE_ENV: 'dev' | 'production';
    }
  }
}

const linePayConfig = {
  channelId: process.env.LINE_PAY_CHANNEL_ID,
  channelSecretKey: process.env.LINE_PAY_CHANNEL_SECRET,
  env: process.env.LINE_PAY_ENV,
};
const linePay = createLinePayClient(linePayConfig);

interface Order {
  amount: number;
  currency: string;
  packages: Array<{
    id: string;
    amount: number;
    products: Array<{
      name: string;
      imageUrl: string;
      quantity: number;
      price: number;
    }>;
  }>;
}

const orders: Record<string, Order> = {};

app.post('/line-pay/request', async (req: Request, res: Response, next: NextFunction) => {
  const orderId = uuidv4();
  const confirmUrl = `${
    process.env.NODE_ENV === 'dev'
      ? 'https://127.0.0.1:3000'
      : 'https://node-typescript-linepay-test.onrender.com'
  }/line-pay/confirm`;
  const cancelUrl = 'https://127.0.0.1:3000/line-pay/cancel';
  const order = {
    amount: 1000,
    currency: 'TWD',
    orderId,
    packages: [
      {
        id: 'products_1',
        amount: 1000,
        products: [
          {
            name: 'Test product',
            imageUrl: 'https://source.unsplash.com/random/300x300/?food',
            quantity: 1,
            price: 1000,
          },
        ],
      },
    ],
  };
  orders[ orderId ] = order;
  try {
    const response = await linePay.request.send({
      body: {
        ...order,
        redirectUrls: {
          confirmUrl,
          cancelUrl,
        },
      }
    });
    res.send(response);
  } catch (error) {
    console.error(error);
    next(error);
  }
});

app.get('/line-pay/confirm', async (req: Request, res: Response, next: NextFunction) =>
{
  try {
    const {transactionId, orderId} = req.query as {transactionId: string; orderId: string};
    const { amount, currency } = orders[orderId];
    const response = await linePay.confirm.send({
      transactionId,
      body: {
        amount,
        currency,
      },
    });
    console.log(response);
    res.send(response);
  } catch (error) {
    console.error(error);
    next(error);
  }
});

app.post('/line-pay/check-payment', async (req: Request, res: Response, next: NextFunction) =>
{
  try {
  const response = await linePay.checkPaymentStatus.send({
    transactionId: req.body.transactionId,
    params: {},
  });
    res.send(response);
  } catch (error) {
    console.error(error);
    next(error);
  }
});

app.post('/line-pay/payment-details', async (req: Request, res: Response, next: NextFunction) =>
{
  try {
    const { transactionId } = req.body;
  const response = await linePay.paymentDetails.send({
    params: {
      transactionId,
    },
  });
    res.send(response);
  } catch (error) {
    console.error(error);
    next(error);
  }
})

interface QRCodeData {
  id: string;
  seatId: string;
  startedAt: string;
  endedAt: string;
}

const qrCodes: QRCodeData[] = []; //模擬資料庫環境

app.get('/qrcodes/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  const qrCode = qrCodes.find((qrCode) => qrCode.seatId === id);
  if (!qrCode) {
    res.status(404).json({ message: 'QR code not found' });
    return;
  }
  const { seatId, startedAt, endedAt } = qrCode;
  const isExpired = dayjs().isAfter(dayjs(endedAt));
  if (isExpired) {
    res.status(400).json({message: 'QR code has expired'});
    return;
  }
  const data = `https://www.example.com/order?tableId=${qrCode.seatId}&startedAt=${qrCode.startedAt}&endedAt=${qrCode.endedAt}`;
  try {
    const qrCodeDataUrl = await QRCode.toDataURL(data);
    res.send(`<img src="${qrCodeDataUrl}" />`);
  } catch (error) {
    res.status(400).json({message: 'Invalid data'});
  }
});

app.post('/qrcodes', async (req: Request, res: Response) => {
  const {seatId, startedAt, endedAt} = req.body;
  const seatNumber = seatId;

  // 檢查參數是否合法
  if (
    isNaN(seatNumber) ||
    !dayjs(startedAt as string).isValid() ||
    !dayjs(endedAt as string).isValid() ||
    dayjs(endedAt as string).isBefore(dayjs(startedAt as string))
  ) {
    res.status(400).json({message: 'Invalid parameters'});
    return;
  }

  // 檢查是否已經有 QRCode 了
  const existingQrCode = qrCodes.find(
    (qrCode) =>
      qrCode.seatId === seatNumber &&
      dayjs(qrCode.startedAt).isSame(startedAt as string) &&
      dayjs(qrCode.endedAt).isSame(endedAt as string) &&
      !dayjs(qrCode.endedAt).isBefore(dayjs())
  );
  if (existingQrCode) {
    res.json({
      id: existingQrCode.id,
      dataUrl: `https://www.example.com/qrcodes/${existingQrCode.id}`,
    });
    return;
  }

  const id = uuidv4();
  const qrCodeData = {id, seatId: seatNumber, startedAt, endedAt};

  try {
    const qrCodeDataUrl = await QRCode.toDataURL(JSON.stringify(qrCodeData));
    qrCodes.push(qrCodeData);
    res.json({id, dataUrl: qrCodeDataUrl});
  } catch (error) {
    res.status(400).json({message: 'Invalid data'});
  }
});



app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
