const express = require('express')
const cors = require('cors')
require('dotenv').config()
const { MongoClient, ServerApiVersion } = require('mongodb')
const app = express()
const port = process.env.PORT || 4500

// middleware
app.use(cors())
app.use(express.json())


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.eruzs6g.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });



async function run() {
    try {
        await client.connect();
        const servicesCollection = client.db("doctors_portal").collection("services");
        const bookingCollection = client.db("doctors_portal").collection("booking");


        app.get('/services', async (req, res) => {
            const query = {}
            const cursor = servicesCollection.find(query);
            const services = await cursor.toArray()
            res.send(services)
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
                const available = service.slots.filter(s=>!booked.includes(s))
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