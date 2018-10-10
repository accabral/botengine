//#region REQUIRE
var lambotenginecore=require('./lambotenginecore');
const { BotFrameworkAdapter, ConsoleAdapter, ConversationState, MemoryStorage } = require('botbuilder');
//const { TableStorage } = require('botbuilder-azure');
const restify = require('restify');
const socketio=require('socket.io');
const { mainBot } = require('./mainBot');
const { stateObject } = require('./stateObject');
var querystring = require('querystring');
var url = require('url');
var storage = require('azure-storage');
require('dotenv').config();
//#endregion

// const BOT_FILE = path.join(__dirname, (process.env.botFilePath || ''));
// let botConfig;
// try {
//     // Read bot configuration from .bot file.
//     botConfig = BotConfiguration.loadSync(BOT_FILE, process.env.botFileSecret);
// } catch (err) {
// 	console.error("Could not read bot file");
//     process.exit();
// }


//#region initializations
var adapter;
var io;
// Create adapter
if (process.env.CONSOLE=='YES')
    adapter = new ConsoleAdapter();
else{
    adapter = new BotFrameworkAdapter({ 
        appId: process.env.MICROSOFT_APP_ID, 
        appPassword: process.env.MICROSOFT_APP_PASSWORD
    });

	// // Catch-all for any unhandled errors in your bot.
	// adapter.onTurnError = async (context, error) => {
	// 	// This check writes out errors to console log .vs. app insights.
	// 	console.error(`\n [onTurnError]: ${ error }`);
	// 	// Send a message to the user
	// 	context.sendActivity(`Oops. Something went wrong!`);
	// 	// Clear out state
	// 	await convoState.clear(context);
	// 	// Save state changes.
	// 	await convoState.saveChanges(context);
	// };	
}

//MEMORY: (this is a demo)
const azureStorage = new MemoryStorage();

// Add state middleware
let convoState
convoState= new ConversationState(azureStorage);

//INITIALIZE CONTAINERS
var blobService = storage.createBlobService();
var containerName = process.env.BOTFLOW_CONTAINER;
blobService.createContainerIfNotExists(process.env.BOTFLOW_CONTAINER, function(err, result, response) {
	if (err) {
		console.log("ERROR:Couldn't create container %s", containerName);
		console.error(err);
	}
});
blobService.createContainerIfNotExists(process.env.BOTFLOW_CONTAINER_CONTROL, function(err, result, response) {
	if (err) {
		console.log("ERROR:Couldn't create container %s", containerName);
		console.error(err);
	}
});
//#endregion
   
 
//#region Start Console or Server
if (process.env.CONSOLE=='YES')
{
    adapter.listen(async (context) => {
		console.log("CONSOLE");
        main(context);
    });
}
else
{
    // Create server
    let server = restify.createServer();
    server.listen(process.env.port || process.env.PORT || 3978, function () {
        console.log(`${server.name} listening to ${server.url}`);
	});
	io=socketio.listen(server.server);
	io.sockets.on('connection', function(client){
		client.on("session",function(data){
			console.log("Connected:" + data.session)
			client.join(data.session);
		})
		client.on('disconnect', function(){});
	});
		
	//SITE
	server.get(/\/site\/?.*/, restify.plugins.serveStatic({
		directory: "./public",
		appendRequestPath: false
	}));
	//BOT
	const bot = new mainBot(convoState);
    server.post('/api/messages', (req, res) => {
        adapter.processActivity(req, res, async (context) => {
            await bot.onTurn(context,io);
        })
	});
	//SAVE BOT GRAPHICAL AND .BOT
	//ARGUMENTS: key=bot name, botflow=graphical flow
    server.post('/api/bot', (req, res) => {
		var jsonString = '';

		req.on('data', function (data) {
			jsonString += data;
		});

		req.on('end', function () {
			var p=querystring.parse(jsonString);
			var key=p["key"];
			var botFlow=p["botflow"];

			lambotenginecore.log("SAVE DESIGNER:" + botFlow);
			//WRITE IT IN AZURE STORAGE
			var blobService = storage.createBlobService();
			var containerName = process.env.BOTFLOW_CONTAINER;
			blobService.createBlockBlobFromText(
				containerName,
				key,
				botFlow,
				function(error, result, response){
					if(error){
						lambotenginecore.error("03:Couldn't upload string");
						lambotenginecore.error(error);
					} else {
						lambotenginecore.log('Saved ' + key + ' successfully');
					}
				});
						
			var botObject=JSON.stringify(lambotenginecore.convertDiagramToBot(botFlow));
			lambotenginecore.log("SAVE BOT:" + botObject);

			blobService.createBlockBlobFromText(
				containerName,
				key + ".bot",
				botObject,
				function(error, result, response){
					if(error){
						lambotenginecore.error("04:Couldn't upload string");
						lambotenginecore.error(error);
					} else {
						lambotenginecore.log('Saved ' + key + '.bot successfully');
					}
				});

			res.writeHead(200, {'Content-Type': 'text/plain'});
			res.end("OK");
		});
		
	});
	//LOAD BOT (GRAPHICAL PART)
	//ARGUMENTS: KEY=bot name
    server.get('/api/bot', (req, res) => {
		var q=url.parse(req.url,true);
		var key=q.query["key"];

		//WRITE IT IN AZURE STORAGE
		var blobService = storage.createBlobService();
		var containerName = process.env.BOTFLOW_CONTAINER;
		var blobName=key;
		blobService.getBlobToText(
			containerName,
			blobName,
			function(err, blobContent, blob) {
				if (err) {
					console.error("Couldn't download blob %s", blobName);
					console.error(err);
				} else {
					res.writeHead(200, {'Content-Type': 'text/plain'});	
					res.end(blobContent);
				}
			});
    });
    server.get('/api/botcontrol', (req, res) => {
		var jsonString = '';

		var q=url.parse(req.url,true);
		var session=q.query["session"];

		lambotenginecore.log("BOTCONTROL:" + session);
		
		//READ IT FROM AZURE STORAGE
		var blobService = storage.createBlobService();
		var containerName = process.env.BOTFLOW_CONTAINER_CONTROL;
		var blobName=session;
		blobService.getBlobToText(
		containerName,
		blobName,
		function(err, blobContent, blob) {
			if (err) {
				lambotenginecore.error("Couldn't download blob " + blobName);
				lambotenginecore.error(err);
			} else {
				lambotenginecore.log("Sucessfully downloaded blob " + blobName);
				lambotenginecore.log(blobContent);

				res.writeHead(200, {'Content-Type': 'text/plain'});	
				res.end(blobContent);
				return;
			}
		});
	});

	//var savedAddress;
	server.get('/api/playStep', async (req, res) => {
		// Lookup previously saved conversation reference
		//const reference = await findReference(req.body.refId);
		var q=url.parse(req.url,true);
		var m=q.query["key"];
		var botName=q.query["bot"];
		//var session=q.query["session"];
		var conversationReference=JSON.parse(q.query["cr"]);
		// Proactively notify the user
		var myBot=await lambotenginecore.AsyncPromiseReadBotFromAzure(storage, botName + ".bot");
		var botPointer=lambotenginecore.getBotPointerIndexFromKey(myBot,m);

		adapter.continueConversation(conversationReference, async (context) => {
			let convoState
			convoState= new ConversationState(azureStorage);

			var state=new stateObject(convoState);
			state.context=context;
			await state.setBotPointer(botPointer,m);
			await state.saveChanges();

			await lambotenginecore.RenderConversationThread(context, myBot,io,state);
		});

		res.send(200);

	});
}
//#endregion