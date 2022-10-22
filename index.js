const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken');
require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express()
const port = process.env.PORT || 4500

// middleware
app.use(cors())
app.use(express.json())


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.eruzs6g.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized Access' })
    }
    const token = authHeader.split(' ')[1]
    jwt.verify(token, process.env.JWT_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden access' })
        }
        req.decoded = decoded
        next()
    })
}

async function run() {
    try {
        await client.connect();
        const servicesCollection = client.db("doctors_portal").collection("services");
        const bookingCollection = client.db("doctors_portal").collection("booking");
        const usersCollection = client.db("doctors_portal").collection("users");
        const doctorsCollection = client.db("doctors_portal").collection("doctors");
        const paymentCollection = client.db("doctors_portal").collection("payments");


        // verify Admin Middleware
        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email
            const requesterAccount = await usersCollection.findOne({ email: requester })
            if (requesterAccount.role === 'admin') {
                next();
            }
            else {
                res.status(403).send({ message: 'forbidden' })
            }
        }

        // payment ai 
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const service = req.body;
            const price = service.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({ clientSecret: paymentIntent.client_secret })
        });
        // get all services 
        app.get('/services', async (req, res) => {
            const query = {}
            const cursor = servicesCollection.find(query);
            const services = await cursor.toArray()
            res.send(services)
        })
        app.get('/services-name', async (req, res) => {
            const query = {}
            const cursor = servicesCollection.find(query).project({ name: 1 });
            const services = await cursor.toArray()
            res.send(services)
        })


        app.get('/users', verifyJWT, async (req, res) => {
            const cursor = await usersCollection.find({}).toArray()
            res.send(cursor)
        })


        // admin verify process 
        app.get('/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email
            const user = await usersCollection.findOne({ email: email })
            const isAdmin = user.role === 'admin'
            res.send({ admin: isAdmin })

        })
        /**  
         * create token create step
         * step 1: open terminal and enter node
         * step 2: require('crypto').randomBytes(64).toString('hex')                         
        */
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email
            const user = req.body
            const filter = { email: email }
            const options = { upsert: true }
            const updateDoc = {
                $set: user,
            }
            const result = await usersCollection.updateOne(filter, updateDoc, options)
            const token = jwt.sign({ email: email }, process.env.JWT_TOKEN, { expiresIn: '1h' });
            res.send({ result, token })
        })


        // Admin user 
        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email
            const filter = { email: email }
            const updateDoc = {
                $set: { role: 'admin' },
            }
            const result = await usersCollection.updateOne(filter, updateDoc)
            res.send(result)
        })


        //warning 
        // this is not proper way query
        app.get('/available', async (req, res) => {
            const date = req.query.date
            // console.log(date)
            // step:1 get all services
            const services = await servicesCollection.find().toArray();
            //Step 2: get the booking of that day
            const query = { date: date }
            const bookings = await bookingCollection.find(query).toArray()


            //Step 3: for each service, find booking for that service
            services.forEach(service => {
                const serviceBookings = bookings.filter(b => b.treatmentName == service.name)
                const booked = serviceBookings.map(s => s.slot)
                const available = service.slots.filter(s => !booked.includes(s))
                // service.booked = serviceBookings.map(s => s.slot)
                service.slots = available;
            })
            res.send(services)
        })
        /**
         * API naming convention
         * app.get('/booking') // get all booking in this collection or get more then specific condition
         * app.get('/booking/:id') get specific booking
         * app.post('/booking') // add a new booking
         * app.patch('/booking/:id')
         * app.delete('/booking/:id')
         */

        app.get('/booking', verifyJWT, async (req, res) => {
            const patientEmail = req.query.email;
            const decodedEmail = req.decoded.email;
            if (patientEmail == decodedEmail) {
                const query = { email: patientEmail }
                // console.log(query);
                const booking = await bookingCollection.find(query).toArray()
                return res.send(booking)
            } else {
                return res.status(403).send({ message: 'Forbidden access' })
            }

        })
        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatmentName: booking.treatmentName, date: booking.date, name: booking.name }
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingCollection.insertOne(booking)
            return res.send({ success: true, result })
        })
        // Payment booking api
        app.get('/dashboard/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) }
            const result = await bookingCollection.findOne(filter)
            res.send(result)
        })

        app.patch('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }

            const result = await paymentCollection.insertOne(payment);
            const updatedBooking = await bookingCollection.updateOne(filter, updatedDoc);
            res.send(updatedBooking);
        })
        // delete single booking
        app.delete('/booking/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) }
            const result = await bookingCollection.deleteOne(filter)
            res.send(result)
        })

        // doctor added 
        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result)
        })
        // get all doctors
        app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const doctors = await doctorsCollection.find({}).toArray()
            res.send(doctors)
        })
        // delete doctor
        app.delete('/doctor/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email }
            const result = await doctorsCollection.deleteOne(filter)
            res.send(result)
        })
    }
    finally { }
}
run().catch(console.dir)

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Doctors App Listening ${port}`)
})