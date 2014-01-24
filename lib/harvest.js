
/*
    asynch-harvest
 */

module.exports = function(){

    function SwarmHarvest(contextBinder, allowMonkeyTail){
        var self = this;
        if(allowMonkeyTail == undefined){
            allowMonkeyTail = false;
        }

        /*
         default call conventions is that the function takes as the last 2 parameters 2 functions, one for reporting success and result and one for reporting errors
         */

        function defaultHarvestCallConvention(harvest, callBack, args, variable, position){
            var success = function(result){
                harvest.__callResult(result,variable, position);
            }

            var fail = function(error){
                harvest.__callError(error);
            }

            args.push(success);
            args.push(fail);

            try{
                var result = callBack.apply(null, args);
            }   catch(err){
                fail(err);
            }
        }


        function mkArgs(myArguments, from){
            if(!from){
                from = 0;
            }

            if(myArguments.length <= from){
                return null;
            }
            var args = [];
            for(var i = from; i<myArguments.length;i++){
                args.push(myArguments[i]);
            }
            return args;
        }


        var internalSuccessHandler;
        this.onSuccess = function(handler){
            if(contextBinder){
                internalSuccessHandler = contextBinder(handler);
            } else {
                internalSuccessHandler = handler;
            }
        }

        var internalFailHandler;
        this.onFail = function(handler){
            if(contextBinder){
                internalFailHandler = contextBinder(handler);
            } else {
                internalFailHandler = handler;
            }
        }

        var internalFinishStatus = 0;
        //return -1 if error, 0 if continue, 1 for success
        this.finished = function(){
            return internalFinishStatus;
        }



        //public for the sake of custom conventions
        this.__callError = function(error){
            internalFinishStatus = -1;
            if(internalFailHandler){
                internalFailHandler( error );
            }
        }



        var __freeVariables = {};
        function addPendingCallToFreeVariable(freeVariable, pendingCall){
            var fv = __freeVariables[freeVariable.name()];
            if(!fv){
                __freeVariables[freeVariable.name()] = freeVariable;
            }
            fv.addPendingCall(pendingCall);
        }


        //public for the sake of custom conventions
        this.__callResult = function(result, variable, position){
            if(internalFinishStatus == 0){
                if(variable){
                    if(position){
                        if(this[variable] == undefined){
                            this[variable] = [];
                        }
                        this[variable][position] = result;
                    } else {
                        this[variable] = result;
                    }

                    var fv = __freeVariables[variable];
                    if(fv){
                        fv.bindVariable(variable, position);
                    } else {
                        console.log("Harvesting unknown variable ",variable);
                    }
                }
            } else {
                if(internalFinishStatus == 1 ){
                    console.log("Possible harvest error, result calls encountered after archiving success. Dumping debug info:", result, variable, position);
                }
                //else ignore these calls.. nothing else we can do for a better world..
            }
        }


        //clean internal references
        this.stop = function(){
            __freeVariables = {};
            internalFinishStatus = -2; //stopped from outside, prevent any call except onFail
            if(internalFailHandler){
                internalFailHandler( new Error("Harvest stopped from outside"));
            }
        }

        function bindContext(calback){
            var apiFunction;
            if(contextBinder){
                apiFunction = contextBinder(callback);
            } else {
                apiFunction = callback;
            }
            return apiFunction;
        }

        function detectFreeVars(args){
            var result = [];
            for(var i = 0; i< args.length; i++){
                var v = args[i];
                if( v instanceof HarvestWaitingVariable) {
                    result.push(v.value());
                }
                else
                if(allowMonkeyTail && typeof v == "string"){
                    var ch = v.charAt(0)
                    if(ch == "@"){
                        result.push(v.substring(1));
                    }
                }
            }
            return result;
        }


        function createPendingCall(variableName, index, apiFunction , args){
            var freeVars = detectFreeVars(args);
            var pending = new PendingCall(defaultHarvestCallConvention, variableName, index, apiFunction, args, freeVars);

            if(freeVars.length != 0){
                for(var i = 0; i < freeVars.length; i++ ){
                    addPendingCallToFreeVariable(freeVars[i], pending);
                }
            } else {
                pending.call();
            }
        }

        this.load = function(variableName, callback ){
            var args = mkArgs(arguments, 2);
            var apiFunction = bindContext(callback);
            createPendingCall(variableName, undefined, apiFunction , args);
        }

        this.do = function(callback ){
            var args = mkArgs(arguments, 1);
            var apiFunction = bindContext(callback);
            createPendingCall(undefined, undefined, apiFunction , args);
        }

        this.loadAt = function(arrayName, index,  callback ){
            var args = mkArgs(arguments, 3);
            var apiFunction = bindContext(callback);
            createPendingCall(arrayName, index, apiFunction , args);
        }

        this.loadWithConvention = function(variableName, convention, api ){
            //to be implemented. convention is a method that knows how to call the API function
            var args = mkArgs(arguments, 3);
            throw "Not implemented yet";
        }

        // depends by harvest, use self
        function PendingCall(callConvention, variable, position, callBack, args, freeVariables){
            var consumableList = freeVariables.strings.slice(0);

            this.bindFreeVariable = function(variable){
                var index = consumableList.indexOf(variable,0);
                if(index != -1){
                    consumableList.splice(index,1);
                } else {
                    self.__callError(new Error("Harvesting error, multiple results for the same variable"));
                }

                if(consumableList.length == 0 && internalFinishStatus == 0 ){
                    callConvention(self, callBack, args, variable, position);
                }
            }

            this.call = function(){
                if(freeVariables.length == 0 && internalFinishStatus == 0 ){
                    for(var j=0;j<freeVariables.indexes.length;j++){
                        args[freeVariables.indexes[j]] = self[freeVariables.strings[j]];
                    }
                    callConvention(self, callBack, args, variable, position);
                }
            }
        }
    }



    function HarvestWaitingVariable(name){
        var waitingList = [];
        this.name = function(){
            return name;
        }

        var arrayWaitCounter = 0;
        this.requestCount = function(){
            counter++;
        }

        this.answerCount = function(){


        }

        this.addPendingCall = function(pc){
            waitingList.push(pc);
        }


        this.bindVariable = function(variable, position){
            if(position){
                arrayWaitCounter--;
                if(arrayWaitCounter != 0){
                    return ;
                }
            }

            //bind a
            for(var i = 0; i < waitingList.length; i++){
                waitingList[i].bindFreeVariable(variable);
            }
        }
    }

    if(SwarmHarvest.prototype.wait == undefined){
        SwarmHarvest.prototype.wait = function(){
            return new HarvestWaitingVariable(name);
        }
    }

//trying to not pollute the global space, as this library should be used in many projects. Define your own wait function if wait is taken
    if(wait == undefined){
        wait = SwarmHarvest.prototype.wait;
    } else {
        console.log("Warning: refusing to overwrite 'wait' for use with asyn-harvest library. 'wait' is already defined. Rename your 'wait', or rename SwarmHarvest.prototype.wait. Also you can use @ notation instead of wait.");
    }


    this.create = function(contextBinder, allowMonkeyTail){
        return new SwarmHarvest(contextBinder, allowMonkeyTail);
    }

}


