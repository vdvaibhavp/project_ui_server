const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const app = express();


// setting build 

app.use(express.static(path.join(__dirname, '../project_ui/build')));

app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, '../project_ui/build', 'index.html'));
});

const { Pool } = require('pg');
const bodyParser = require('body-parser');


// Data base connection
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'Recon_CA',
  password: 'root',
  port: 5432, // Default PostgreSQL port
});

app.use(express.json());


//logging - winston
const winston = require("winston");
const logger = winston.createLogger({

  level: "info",
  //standard log format
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      (info) => `${info.timestamp} ${info.level}: ${info.message}`
    )
  ),
  // Log to the console and a file
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "logs/app.log" }),
  ],
});

const multer = require('multer');
const upload = multer();

app.use(cors());
const port = 8080;
const unirest = require("unirest");


var name;
app.get('/authenticate', (req, res) => {
  const {username, password} = req.query;
   name=username;  
  logger.info(`Received a ${req.method} request for ${req.url}`);
  const request = unirest("POST", "https://t4.automationedge.com/aeengine/rest/authenticate")
                  .query({username, password });
                  request.end(function (response) {
                    console.log(response.body)
                    if (response.error) {
                        logger.error(`${response.error.message} from t3 instance`);
                        res.status(401).send('Error occurred');
                      } else {
                        logger.info(`Session Token Received from t3 instance`);
                        res.status(200).json(response.body);
                      }
                  });
                  console.log(username, "this")
                  
});




app.post('/upload', upload.array('files', 2), async (req, res) => {
  logger.info(`Received a ${req.method} request for to upload a file.`)
  const { files } = req;

  const sessionToken = req.body.sessionToken;
  const tenant_name = req.body.tenantName;
  const tenant_orgcode = req.body.tenantOrgCode;
  const mailId = req.body.mailId;

  // Uploading file1 to the t3 server
  const response1 = await unirest.post("https://t4.automationedge.com/aeengine/rest/file/upload")
                                 .headers({ 'Content-Type': 'multipart/form-data', 'X-Session-Token': sessionToken })
                                 .query({'workflow_name': 'GSTR_2B_1', 'workflow_id': '4339'})
                                 .attach('file', files[0].buffer, { filename: files[0].originalname })
  
  const fileId1 = response1.body.fileId;

  //uploading file2 to the t3 server
  const response2 = await unirest.post("https://t4.automationedge.com/aeengine/rest/file/upload")
                                 .headers({ 'Content-Type': 'multipart/form-data', 'X-Session-Token': sessionToken })
                                 .query({'workflow_name': 'GSTR_2B_1', 'workflow_id': '4339'})
                                 .attach('file', files[1].buffer, { filename: files[1].originalname })
 
  const fileId2 = response2.body.fileId;



  // Executing workflow with input files
  await unirest.post("https://t4.automationedge.com/aeengine/rest/execute")
               .headers({ 'Content-Type': 'application/json', 'X-Session-Token': sessionToken })
               .query({'workflow_name': 'GSTR_2B_1', 'workflow_id': '4339'})
               .send(
                {"orgCode": tenant_orgcode,"workflowName":"GSTR_2B_1",
                "userId": tenant_name, "source":"Rest Test","responseMailSubject":"null",
                "params":[{"name": "Input_File", "value":fileId1, "type": "File"},
                {"name": "GST_File_Path", "value":fileId2, "type": "File"}, 
                {"name": "Destination_Address", "value": mailId, "type": "String"}]}
                )
               .end(function (response) {
                  if (response.error) {
                      logger.error(`Error in executing workflow`)
                      console.error(response.error);
                      res.status(500).send('Error occurred while executing worfkflow');
                    } else {
                      logger.info(`Automaiton request ID received ${response.body.automationRequestId}`)
                      res.status(200).json(response.body.automationRequestId);
                    }
                });
  });

  
app.get('/status', async (req, res) => {
  logger.info(`Received a ${req.method} request for ${req.url} to check status`);
  const {sessionToken, requestId} = req.query;
  
  let status = 'pending';
  let fileName = '';
  let fileValue = '';
  let request_id = '';
  let rowvalue='';
  let rowname='';
  let remaining_creditvalue;
  let total_creditremaining;
  // var row_count=0;
  // Checking Workflow status after every 3 seconds
  let counter = 0;
   
  while (status !== 'Complete' && status !== 'Failure') {
    console.log(sessionToken, requestId);
    const request = await unirest("GET", `https://t4.automationedge.com/aeengine/rest/workflowinstances/${requestId}`)
                            .headers({ 'Content-Type': 'application/json', 'X-Session-Token': sessionToken })
                            .end(function (response) {
                              console.log(response.body);
                                if (response.error) {
                                  console.log(response.error);
                                  res.status(500).send(response.error);
                                } else {
                                    status = response.body.status;
                                    if (response.body.workflowResponse) {
                                        fileName = JSON.parse(response.body.workflowResponse).outputParameters[1].name;
                                        if (fileName == 'Output File.xlsx'){
                                        fileValue = JSON.parse(response.body.workflowResponse).outputParameters[1].value;
                                        }
                                        else {
                                          fileValue = JSON.parse(response.body.workflowResponse).outputParameters[0].value;
                                        }

                                        //Row Count
                                        if(response.body.workflowResponse)
                                        {
                                           rowname=JSON.parse(response.body.workflowResponse).outputParameters[1].value;
                                           if(rowname=="value")
                                           {
                                            rowvalue=JSON.parse(response.body.workflowResponse).outputParameters[1].value;
                                           }
                                           else{
                                              rowvalue=JSON.parse(response.body.workflowResponse).outputParameters[0].value;
                                           }
                                        }
                                        //check username is present in db or not if present then add row count
                                        var t4username=name;
                                        //fetch data from database
                                        pool.query('select rowcount,username,remcredit from users',(err,result)=>{
                                          if (!err) {
                                            const rows = result.rows;
                                            console.log(rows)
                                            if (rows.length > 0) {
                                                let matchedRow;
                                                for (const row of rows) {
                                                    if (row.username == t4username) {
                                                        matchedRow=row;
                                                        //break;
                                                    }
                                                  }
                                                  if(matchedRow)
                                                  {
                                                    rowcountValue = matchedRow.rowcount;
                                                    remaining_creditvalue=matchedRow.remcredit;

                                                    console.log('database row count:', rowcountValue);
                                                   console.log('database remaining credit:',remaining_creditvalue);

                                                     myrow_count=parseInt(rowvalue)+parseInt(rowcountValue); 
                                                     total_creditremaining=parseInt(remaining_creditvalue)-parseInt(rowvalue);
                                                    
                                                    
                                                    pool.query('UPDATE users SET rowcount = $1, remcredit = $2 WHERE username = $3',[myrow_count,total_creditremaining,t4username],(err,res)=>{
                                                      if(!err){
                                                       console.log("insert row count Successfully")
                                                      }else{
                                                       console.log("Error while inserting row count");
                                                      }
                                                     })

                                                  }
                                                   else {
                                                    console.log("Username Not Found In Database")
                                                   }
                                                }
                                              }
                                        });

                                        }
                                        request_id = response.body.id;
                                  }
                                  if (status === 'New' && !response.body.agentName) {
                                            counter++;
                                            if (counter === 10) {
                                                status = 'no_agent';
                                                }
                                  } else {
                                            counter = 0;
                                  }
                                  
                            });
                            if (status === 'Complete' || status === 'Failure' || status === 'no_agent') {

                              break;
                            }
                            
                            await new Promise(resolve => setTimeout(resolve, 3000)); 
  };

      if (status === 'Complete') {
       
        res.status(200).send({ status: 'Complete ! Please Check Your Mail', 
                               request_id: requestId,
                               file_id: fileValue,
                              row_count:rowvalue,
                             total_credit:total_creditremaining});

          } else if (status === 'Failure') {
        res.status(200).send({ status: 'Failure ! Please Try Again (Check Input Files)' });
        } else if (status === 'no_agent') {
          res.status(200).send({status: 'Contact the Administrator Agent Is Under Maintainance'});
        }

});

app.get('/download', async (req, res) => {
  const {sessionToken, requestId, fileId} = req.query;
  try {
    // Make the API request to the external download API
    const response = await axios({
      method: 'GET',
      url: 'https://t4.automationedge.com/aeengine/rest/file/download',
      params: { file_id: fileId, request_id: requestId }, // Set the fileID as a query parameter
      responseType: 'stream',
      headers: {
        'X-Session-Token': sessionToken, // Add the session token in the Authorization header
      },
    });
  
    // Get the file name from the response headers or set a default name
    const fileName = response.headers['content-disposition']
      ? response.headers['content-disposition'].split('filename=')[1]
      : 'downloaded_file.xlsx'; // Replace 'downloaded_file.ext' with the desired default name
  
    // Set the headers for the file download
    res.setHeader('Content-disposition', 'attachment; filename=' + fileName);
    res.setHeader('Content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); // Adjust the content-type based on your file type if needed
    
    // Stream the file to the client
    response.data.pipe(res);
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).send('Error downloading file');
  }
});


// This is code for get the data from registrationpage into csv file and file is store in our local directory...




const csvFilePath = path.join(
  'C:', 'Setup', 'AE', 'Process-Studio', 'ps-workspace', 'Bulk_User_Creation','user_data.csv'
);

app.post('/api/addUser', (req, res) => {
  const userData = req.body;
  const csvData = `${userData.firstName},${userData.lastName},${userData.email},${userData.username}\n`;

  try {
    // Check if the CSV file exists, and if not, re-create it
    if (!fs.existsSync(csvFilePath)) {
      fs.writeFileSync(csvFilePath, 'firstname, lastname, email, username\n', 'utf-8');
    }

    const existingData = fs.readFileSync(csvFilePath, 'utf-8');
    const existingUsernames = existingData.split('\n').slice(1).map(line => line.split(',')[3]);

    if (existingUsernames.includes(userData.username)) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    fs.appendFileSync(csvFilePath, csvData, 'utf-8');
    console.log('User data appended to CSV file:', userData);
    res.status(200).json({ message: 'User data added successfully' });
  } catch (error) {
    console.error('Error appending user data to CSV file:', error);
    res.status(500).json({ error: 'Failed to add user data' });
  }
});



app.listen(port, () => {
  console.log(`Server app listening at http://10.41.11.10:${port}`);
});

